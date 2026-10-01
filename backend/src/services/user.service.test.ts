import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../repositories/user.repository.js";

const findByEmailMock = vi.fn();
const findByIdMock = vi.fn();
const createMock = vi.fn();
const updateStatusMock = vi.fn();
const hashPasswordMock = vi.fn();
const recordMock = vi.fn();

vi.mock("../repositories/user.repository.js", () => ({
  userRepository: {
    findByEmail: (...args: unknown[]) => findByEmailMock(...args),
    findById: (...args: unknown[]) => findByIdMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    updateStatus: (...args: unknown[]) => updateStatusMock(...args),
  },
}));

vi.mock("./password.service.js", () => ({
  hashPassword: (...args: unknown[]) => hashPasswordMock(...args),
}));

vi.mock("./audit-log.service.js", () => ({
  record: (...args: unknown[]) => recordMock(...args),
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

const { createUser, updateUserStatus, EmailAlreadyExistsError, WeakPasswordError, UserNotFoundError } =
  await import("./user.service.js");

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    name: "Maria Silva",
    email: "maria@example.com",
    passwordHash: "hash",
    role: "operator",
    status: "active",
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "admin-1",
    ...overrides,
  };
}

describe("user.service.createUser", () => {
  beforeEach(() => {
    findByEmailMock.mockReset();
    findByIdMock.mockReset();
    createMock.mockReset();
    hashPasswordMock.mockReset();
    recordMock.mockReset();
    recordMock.mockResolvedValue(undefined);
    hashPasswordMock.mockResolvedValue("hashed-password");
  });

  it("rejeita e-mail já cadastrado", async () => {
    findByEmailMock.mockResolvedValue(makeUser());

    await expect(
      createUser({
        name: "Novo",
        email: "maria@example.com",
        password: "senha-longa-1",
        role: "operator",
        actingAdminId: "admin-1",
      }),
    ).rejects.toThrow(EmailAlreadyExistsError);

    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejeita senha com menos de 8 caracteres", async () => {
    findByEmailMock.mockResolvedValue(null);

    await expect(
      createUser({
        name: "Novo",
        email: "novo@example.com",
        password: "curta12",
        role: "operator",
        actingAdminId: "admin-1",
      }),
    ).rejects.toThrow(WeakPasswordError);

    expect(findByEmailMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("cria usuário como status=active por padrão, com createdBy preenchido, e audita USER_CREATE", async () => {
    findByEmailMock.mockResolvedValue(null);
    createMock.mockResolvedValue(makeUser({ status: "active", createdBy: "admin-1" }));

    const user = await createUser({
      name: "Novo",
      email: "novo@example.com",
      password: "senha-longa-1",
      role: "operator",
      actingAdminId: "admin-1",
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "active", createdBy: "admin-1" }),
    );
    expect(user.status).toBe("active");
    expect(recordMock).toHaveBeenCalledWith(
      "USER_CREATE",
      "user",
      user.id,
      "admin-1",
      expect.objectContaining({ email: user.email, role: user.role }),
    );
  });

  it("respeita status explícito quando informado (admin pode criar já inactive/blocked)", async () => {
    findByEmailMock.mockResolvedValue(null);
    createMock.mockResolvedValue(makeUser({ status: "blocked" }));

    await createUser({
      name: "Novo",
      email: "novo@example.com",
      password: "senha-longa-1",
      role: "operator",
      status: "blocked",
      actingAdminId: "admin-1",
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "blocked" }),
    );
  });
});

describe("user.service.updateUserStatus", () => {
  beforeEach(() => {
    findByIdMock.mockReset();
    updateStatusMock.mockReset();
    updateStatusMock.mockResolvedValue(undefined);
    recordMock.mockReset();
    recordMock.mockResolvedValue(undefined);
  });

  it("lança UserNotFoundError para id inexistente", async () => {
    findByIdMock.mockResolvedValue(null);

    await expect(updateUserStatus("id-inexistente", "inactive", "admin-1")).rejects.toThrow(
      UserNotFoundError,
    );
  });

  it("audita USER_DISABLE ao desativar", async () => {
    findByIdMock.mockResolvedValueOnce(makeUser({ status: "active" }));
    findByIdMock.mockResolvedValueOnce(makeUser({ status: "inactive" }));

    await updateUserStatus("user-1", "inactive", "admin-1");

    expect(recordMock).toHaveBeenCalledWith(
      "USER_DISABLE",
      "user",
      "user-1",
      "admin-1",
      expect.objectContaining({ oldValue: "active", newValue: "inactive" }),
    );
  });

  it("audita USER_UPDATE ao reativar (voltar para active)", async () => {
    findByIdMock.mockResolvedValueOnce(makeUser({ status: "inactive" }));
    findByIdMock.mockResolvedValueOnce(makeUser({ status: "active" }));

    await updateUserStatus("user-1", "active", "admin-1");

    expect(recordMock).toHaveBeenCalledWith(
      "USER_UPDATE",
      "user",
      "user-1",
      "admin-1",
      expect.objectContaining({ oldValue: "inactive", newValue: "active" }),
    );
  });
});
