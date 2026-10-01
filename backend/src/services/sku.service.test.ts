import { beforeEach, describe, expect, it, vi } from "vitest";

const incrementAndGetMock = vi.fn();
const assertCategoryActiveMock = vi.fn();

vi.mock("../repositories/sku-sequence.repository.js", () => ({
  skuSequenceRepository: {
    incrementAndGet: (...args: unknown[]) => incrementAndGetMock(...args),
  },
}));

vi.mock("./category.service.js", () => ({
  assertCategoryActive: (...args: unknown[]) => assertCategoryActiveMock(...args),
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

const { generateNextSku } = await import("./sku.service.js");

describe("sku.service.generateNextSku", () => {
  beforeEach(() => {
    incrementAndGetMock.mockReset();
    assertCategoryActiveMock.mockReset();
    assertCategoryActiveMock.mockResolvedValue({ id: "cat-1", code: "BERM", active: true });
  });

  it("dado currentValue=24, retorna ERP-BERM-000025 (spec 004, critério 'geração simples')", async () => {
    incrementAndGetMock.mockResolvedValue(25);

    const sku = await generateNextSku("BERM");

    expect(sku).toBe("ERP-BERM-000025");
    expect(incrementAndGetMock).toHaveBeenCalledWith(expect.anything(), "BERM");
  });

  it("valida a categoria antes de incrementar — categoria inválida nunca gera sequência", async () => {
    assertCategoryActiveMock.mockRejectedValue(new Error("categoria inválida"));

    await expect(generateNextSku("XXXX")).rejects.toThrow();
    expect(incrementAndGetMock).not.toHaveBeenCalled();
  });

  it("faz zero-padding até 6 dígitos para sequências pequenas", async () => {
    incrementAndGetMock.mockResolvedValue(1);

    await expect(generateNextSku("VEST")).resolves.toBe("ERP-VEST-000001");
  });
});
