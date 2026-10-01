import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceAccountRecord } from "../repositories/marketplace-account.repository.js";

const getProductByIdMock = vi.fn();
const findByIdMock = vi.fn();
const runAccountOperationMock = vi.fn();
const getCuratedCategoriesMock = vi.fn();
const suggestCategoryOnMercadoLivreMock = vi.fn();

vi.mock("./product.service.js", () => ({
  getProductById: (...args: unknown[]) => getProductByIdMock(...args),
}));

vi.mock("../repositories/marketplace-account.repository.js", () => ({
  marketplaceAccountRepository: { findById: (...args: unknown[]) => findByIdMock(...args) },
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

vi.mock("../plugins/marketplaces/mercado-livre-category-catalog.js", () => ({
  getCuratedCategories: (...args: unknown[]) => getCuratedCategoriesMock(...args),
}));

vi.mock("../plugins/marketplaces/mercado-livre.connector.js", () => ({
  suggestCategory: (...args: unknown[]) => suggestCategoryOnMercadoLivreMock(...args),
}));

// `runAccountOperation` fica mockado, mas as demais exportações (AccountBusyError) são as reais.
vi.mock("./account-operation.service.js", async () => {
  const actual = await vi.importActual<typeof import("./account-operation.service.js")>("./account-operation.service.js");
  return { ...actual, runAccountOperation: (...args: unknown[]) => runAccountOperationMock(...args) };
});

const { suggestCategory, MarketplaceSuggestionUnsupportedError } = await import("./marketplace-category-suggestion.service.js");
const { AccountBusyError } = await import("./account-operation.service.js");
const { MarketplaceAccountNotFoundError } = await import("./marketplace-account.service.js");
const { MarketplaceAccountMismatchError } = await import("./marketplace-listing.service.js");

function makeAccount(overrides: Partial<MarketplaceAccountRecord> = {}): MarketplaceAccountRecord {
  return {
    id: "acc-1",
    marketplace: "mercado_livre",
    label: "Loja Demo - Loja 1",
    credential: "CIFRADA-NAO-VAZAR",
    credentialPreview: "****cdef",
    connectionStatus: "connected",
    active: true,
    createdBy: "admin-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    expectedUser: null,
    connectedUserId: null,
    connectedNickname: null,
    ...overrides,
  };
}

const CURATED = [
  { categoryId: "MLB107292", categoryName: "Camisas" },
  { categoryId: "MLB188065", categoryName: "Calças" },
];

beforeEach(() => {
  getProductByIdMock.mockReset().mockResolvedValue({ identificacao: { nome: "Camisa social masculina" } });
  findByIdMock.mockReset().mockResolvedValue(makeAccount());
  runAccountOperationMock.mockReset();
  getCuratedCategoriesMock.mockReset().mockReturnValue(CURATED);
  suggestCategoryOnMercadoLivreMock.mockReset();
});

describe("marketplace-category-suggestion.service.suggestCategory (spec 012, seção 4; ADR-025; T058)", () => {
  it("marketplace diferente de mercado_livre: MarketplaceSuggestionUnsupportedError, sem consultar nada", async () => {
    await expect(suggestCategory({ productId: "p1", marketplace: "shopee", accountId: "acc-1" })).rejects.toThrow(
      MarketplaceSuggestionUnsupportedError,
    );
    expect(getProductByIdMock).not.toHaveBeenCalled();
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("conta inexistente ou inativa: MarketplaceAccountNotFoundError", async () => {
    findByIdMock.mockResolvedValue(null);
    await expect(suggestCategory({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1" })).rejects.toThrow(
      MarketplaceAccountNotFoundError,
    );

    findByIdMock.mockResolvedValue(makeAccount({ active: false }));
    await expect(suggestCategory({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1" })).rejects.toThrow(
      MarketplaceAccountNotFoundError,
    );
  });

  it("conta de outro marketplace: MarketplaceAccountMismatchError", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ marketplace: "shopee" }));
    await expect(suggestCategory({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1" })).rejects.toThrow(
      MarketplaceAccountMismatchError,
    );
  });

  it("sucesso: devolve a sugestão do conector e a lista curada, com o nome do produto", async () => {
    runAccountOperationMock.mockImplementation(
      async (_id: string, op: (ctx: { account: unknown; credential: string }) => Promise<{ value: unknown }>) => {
        const outcome = await op({ account: makeAccount(), credential: "plain-credential" });
        return outcome.value;
      },
    );
    suggestCategoryOnMercadoLivreMock.mockResolvedValue({ value: { categoryId: "MLB107292", categoryName: "Camisas" } });

    const result = await suggestCategory({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1" });

    expect(suggestCategoryOnMercadoLivreMock).toHaveBeenCalledWith("plain-credential", "Camisa social masculina");
    expect(result).toEqual({ suggested: { categoryId: "MLB107292", categoryName: "Camisas" }, options: CURATED });
  });

  it("preditor sem sugestão (null): options continua vindo, suggested null", async () => {
    runAccountOperationMock.mockImplementation(async (_id: string, op: (ctx: { credential: string }) => Promise<{ value: unknown }>) => {
      const outcome = await op({ credential: "plain-credential" } as never);
      return outcome.value;
    });
    suggestCategoryOnMercadoLivreMock.mockResolvedValue({ value: null });

    const result = await suggestCategory({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1" });

    expect(result).toEqual({ suggested: null, options: CURATED });
  });

  it("falha do conector (rede, token, Mercado Livre fora do ar): nunca lança, devolve suggested null com a lista curada", async () => {
    runAccountOperationMock.mockRejectedValue(new Error("Falha ao falar com o Mercado Livre."));

    const result = await suggestCategory({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1" });

    expect(result).toEqual({ suggested: null, options: CURATED });
  });

  it("conta ocupada por outra operação (AccountBusyError): propaga — não é uma falha do preditor", async () => {
    runAccountOperationMock.mockRejectedValue(new AccountBusyError());

    await expect(suggestCategory({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1" })).rejects.toThrow(AccountBusyError);
  });
});
