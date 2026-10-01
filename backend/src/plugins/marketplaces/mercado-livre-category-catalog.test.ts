import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}));

const { getCuratedCategories, CategoryCatalogError } = await import("./mercado-livre-category-catalog.js");

describe("mercado-livre-category-catalog.getCuratedCategories (spec 012, seção 4; ADR-025; T057)", () => {
  beforeEach(() => {
    readFileSyncMock.mockReset();
  });

  it("lê e devolve a lista curada do arquivo", () => {
    readFileSyncMock.mockReturnValue(
      JSON.stringify([
        { categoryId: "MLB1", categoryName: "Camisas" },
        { categoryId: "MLB2", categoryName: "Calças" },
      ]),
    );

    expect(getCuratedCategories()).toEqual([
      { categoryId: "MLB1", categoryName: "Camisas" },
      { categoryId: "MLB2", categoryName: "Calças" },
    ]);
  });

  it("arquivo ausente: CategoryCatalogError orientando rodar o script T057", () => {
    readFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    expect(() => getCuratedCategories()).toThrow(CategoryCatalogError);
    expect(() => getCuratedCategories()).toThrow(/fetch:mercado-livre-categories/);
  });

  it("JSON inválido: CategoryCatalogError", () => {
    readFileSyncMock.mockReturnValue("{ isto não é json válido");

    expect(() => getCuratedCategories()).toThrow(CategoryCatalogError);
  });

  it("arquivo vazio (`[]`): CategoryCatalogError — nunca devolve uma tela de revisão sem opções", () => {
    readFileSyncMock.mockReturnValue("[]");

    expect(() => getCuratedCategories()).toThrow(CategoryCatalogError);
  });

  it("entrada inválida no catálogo: CategoryCatalogError com o índice", () => {
    readFileSyncMock.mockReturnValue(JSON.stringify([{ categoryId: "MLB1", categoryName: "Camisas" }, { categoryId: 123 }]));

    expect(() => getCuratedCategories()).toThrow(/índice 1/);
  });

  it("lê de novo a cada chamada (sem cache) — reflete uma atualização do arquivo entre chamadas", () => {
    readFileSyncMock.mockReturnValueOnce(JSON.stringify([{ categoryId: "MLB1", categoryName: "Camisas" }]));
    expect(getCuratedCategories()).toEqual([{ categoryId: "MLB1", categoryName: "Camisas" }]);

    readFileSyncMock.mockReturnValueOnce(JSON.stringify([{ categoryId: "MLB2", categoryName: "Calças" }]));
    expect(getCuratedCategories()).toEqual([{ categoryId: "MLB2", categoryName: "Calças" }]);
  });
});
