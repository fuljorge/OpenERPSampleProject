import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Category } from "../repositories/category.repository.js";

const findByCodeMock = vi.fn();
const findByIdMock = vi.fn();
const createMock = vi.fn();
const recordMock = vi.fn();

vi.mock("../repositories/category.repository.js", () => ({
  categoryRepository: {
    findByCode: (...args: unknown[]) => findByCodeMock(...args),
    findById: (...args: unknown[]) => findByIdMock(...args),
    create: (...args: unknown[]) => createMock(...args),
  },
}));

vi.mock("./audit-log.service.js", () => ({
  record: (...args: unknown[]) => recordMock(...args),
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

const { createCategory, assertCategoryActive, CategoryCodeAlreadyExistsError, InvalidCategoryError } =
  await import("./category.service.js");

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: "cat-1",
    code: "BERM",
    name: "Bermudas",
    department: "Masculino",
    active: true,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("category.service.createCategory", () => {
  beforeEach(() => {
    findByCodeMock.mockReset();
    createMock.mockReset();
    recordMock.mockReset();
    recordMock.mockResolvedValue(undefined);
  });

  it("rejeita código já cadastrado", async () => {
    findByCodeMock.mockResolvedValue(makeCategory());

    await expect(
      createCategory({ code: "BERM", name: "Bermudas", department: "Masculino", actingAdminId: "admin-1" }),
    ).rejects.toThrow(CategoryCodeAlreadyExistsError);

    expect(createMock).not.toHaveBeenCalled();
  });

  it("cria categoria e audita CATEGORY_CREATE", async () => {
    findByCodeMock.mockResolvedValue(null);
    createMock.mockResolvedValue(makeCategory());

    const category = await createCategory({
      code: "BERM",
      name: "Bermudas",
      department: "Masculino",
      actingAdminId: "admin-1",
    });

    expect(category.code).toBe("BERM");
    expect(recordMock).toHaveBeenCalledWith(
      "CATEGORY_CREATE",
      "category",
      category.id,
      "admin-1",
      expect.objectContaining({ code: "BERM" }),
    );
  });
});

describe("category.service.assertCategoryActive", () => {
  beforeEach(() => {
    findByCodeMock.mockReset();
  });

  it("lança InvalidCategoryError para código inexistente", async () => {
    findByCodeMock.mockResolvedValue(null);
    await expect(assertCategoryActive("XXXX")).rejects.toThrow(InvalidCategoryError);
  });

  it("lança InvalidCategoryError para código inativo", async () => {
    findByCodeMock.mockResolvedValue(makeCategory({ active: false }));
    await expect(assertCategoryActive("BERM")).rejects.toThrow(InvalidCategoryError);
  });

  it("retorna a categoria quando existe e está ativa", async () => {
    const category = makeCategory({ active: true });
    findByCodeMock.mockResolvedValue(category);
    await expect(assertCategoryActive("BERM")).resolves.toEqual(category);
  });
});
