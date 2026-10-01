import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../repositories/user.repository.js";

const findByEmailMock = vi.fn();
const findByIdMock = vi.fn();
const updateLastLoginMock = vi.fn();
const verifyPasswordMock = vi.fn();
const recordMock = vi.fn();

vi.mock("../repositories/user.repository.js", () => ({
  userRepository: {
    findByEmail: (...args: unknown[]) => findByEmailMock(...args),
    findById: (...args: unknown[]) => findByIdMock(...args),
    updateLastLogin: (...args: unknown[]) => updateLastLoginMock(...args),
  },
}));

vi.mock("./password.service.js", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

vi.mock("./audit-log.service.js", () => ({
  record: (...args: unknown[]) => recordMock(...args),
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

const { verifyCredentials, InvalidCredentialsError } = await import("./auth.service.js");

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
    createdBy: null,
    ...overrides,
  };
}

describe("auth.service.verifyCredentials", () => {
  beforeEach(() => {
    findByEmailMock.mockReset();
    findByIdMock.mockReset();
    updateLastLoginMock.mockReset();
    verifyPasswordMock.mockReset();
    recordMock.mockReset();
    recordMock.mockResolvedValue(undefined);
    updateLastLoginMock.mockResolvedValue(undefined);
  });

  it("autentica com credenciais corretas de um usuário ativo", async () => {
    findByEmailMock.mockResolvedValue(makeUser());
    verifyPasswordMock.mockResolvedValue(true);

    const user = await verifyCredentials("maria@example.com", "senha-correta");

    expect(user).toEqual({
      id: "user-1",
      name: "Maria Silva",
      email: "maria@example.com",
      role: "operator",
    });
    expect(recordMock).toHaveBeenCalledWith("LOGIN_SUCCESS", "user", "user-1", "user-1");
    expect(updateLastLoginMock).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("rejeita e-mail inexistente com o mesmo erro genérico de senha incorreta", async () => {
    findByEmailMock.mockResolvedValue(null);

    await expect(verifyCredentials("naoexiste@example.com", "qualquer")).rejects.toThrow(
      InvalidCredentialsError,
    );
    expect(recordMock).toHaveBeenCalledWith("LOGIN_FAILED", "user", undefined, undefined);
  });

  it("rejeita senha incorreta com o mesmo erro genérico", async () => {
    findByEmailMock.mockResolvedValue(makeUser());
    verifyPasswordMock.mockResolvedValue(false);

    await expect(verifyCredentials("maria@example.com", "senha-errada")).rejects.toThrow(
      InvalidCredentialsError,
    );
    expect(recordMock).toHaveBeenCalledWith("LOGIN_FAILED", "user", "user-1", "user-1");
  });

  it("rejeita usuário inactive mesmo com senha correta, sem revelar o motivo", async () => {
    findByEmailMock.mockResolvedValue(makeUser({ status: "inactive" }));

    await expect(verifyCredentials("maria@example.com", "senha-correta")).rejects.toThrow(
      InvalidCredentialsError,
    );
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it("rejeita usuário blocked mesmo com senha correta, sem revelar o motivo", async () => {
    findByEmailMock.mockResolvedValue(makeUser({ status: "blocked" }));

    await expect(verifyCredentials("maria@example.com", "senha-correta")).rejects.toThrow(
      InvalidCredentialsError,
    );
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });
});
