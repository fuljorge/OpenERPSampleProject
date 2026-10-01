import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceAccountRecord } from "../repositories/marketplace-account.repository.js";

const getProductByIdMock = vi.fn();
const findByIdMock = vi.fn();
const runAccountOperationMock = vi.fn();
const suggestSizesMock = vi.fn();

vi.mock("./product.service.js", () => ({
  getProductById: (...args: unknown[]) => getProductByIdMock(...args),
}));

vi.mock("../repositories/marketplace-account.repository.js", () => ({
  marketplaceAccountRepository: { findById: (...args: unknown[]) => findByIdMock(...args) },
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

vi.mock("../plugins/marketplaces/mercado-livre.connector.js", () => ({
  suggestSizes: (...args: unknown[]) => suggestSizesMock(...args),
}));

// `runAccountOperation` fica mockado, mas as demais exportações (AccountBusyError) são as reais.
vi.mock("./account-operation.service.js", async () => {
  const actual = await vi.importActual<typeof import("./account-operation.service.js")>("./account-operation.service.js");
  return { ...actual, runAccountOperation: (...args: unknown[]) => runAccountOperationMock(...args) };
});

const { suggestSize, MarketplaceSizeSuggestionUnsupportedError } = await import("./marketplace-size-suggestion.service.js");
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

const SUGGESTION = { applicable: true, available: ["40,0 BR"], current: "38,0 BR", currentMatches: false, allowCustomSize: false };

beforeEach(() => {
  getProductByIdMock.mockReset().mockResolvedValue({ classificacao: { categoria_codigo: "SAPT" } });
  findByIdMock.mockReset().mockResolvedValue(makeAccount());
  runAccountOperationMock.mockReset();
  suggestSizesMock.mockReset();
});

describe("marketplace-size-suggestion.service.suggestSize (spec 012; achado real 24/09/2026)", () => {
  it("marketplace diferente de mercado_livre: MarketplaceSizeSuggestionUnsupportedError, sem consultar nada", async () => {
    await expect(
      suggestSize({ productId: "p1", marketplace: "shopee", accountId: "acc-1", categoryId: "MLB188064" }),
    ).rejects.toThrow(MarketplaceSizeSuggestionUnsupportedError);
    expect(getProductByIdMock).not.toHaveBeenCalled();
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("conta inexistente ou inativa: MarketplaceAccountNotFoundError", async () => {
    findByIdMock.mockResolvedValue(null);
    await expect(
      suggestSize({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1", categoryId: "MLB188064" }),
    ).rejects.toThrow(MarketplaceAccountNotFoundError);

    findByIdMock.mockResolvedValue(makeAccount({ active: false }));
    await expect(
      suggestSize({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1", categoryId: "MLB188064" }),
    ).rejects.toThrow(MarketplaceAccountNotFoundError);
  });

  it("conta de outro marketplace: MarketplaceAccountMismatchError", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ marketplace: "shopee" }));
    await expect(
      suggestSize({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1", categoryId: "MLB188064" }),
    ).rejects.toThrow(MarketplaceAccountMismatchError);
  });

  it("sucesso: devolve a sugestão do conector, com a categoria já escolhida na revisão", async () => {
    runAccountOperationMock.mockImplementation(
      async (_id: string, op: (ctx: { account: unknown; credential: string }) => Promise<{ value: unknown }>) => {
        const outcome = await op({ account: makeAccount(), credential: "plain-credential" });
        return outcome.value;
      },
    );
    suggestSizesMock.mockResolvedValue({ value: SUGGESTION });

    const result = await suggestSize({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1", categoryId: "MLB188064" });

    expect(suggestSizesMock).toHaveBeenCalledWith("plain-credential", { classificacao: { categoria_codigo: "SAPT" } }, "MLB188064");
    expect(result).toEqual(SUGGESTION);
  });

  it("conta ocupada por outra operação (AccountBusyError): propaga", async () => {
    runAccountOperationMock.mockRejectedValue(new AccountBusyError());

    await expect(
      suggestSize({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1", categoryId: "MLB188064" }),
    ).rejects.toThrow(AccountBusyError);
  });

  it("falha real (rede, token, Mercado Livre fora do ar): propaga — diferente da sugestão de categoria, não é uma previsão dispensável", async () => {
    runAccountOperationMock.mockRejectedValue(new Error("Falha ao falar com o Mercado Livre."));

    await expect(
      suggestSize({ productId: "p1", marketplace: "mercado_livre", accountId: "acc-1", categoryId: "MLB188064" }),
    ).rejects.toThrow("Falha ao falar com o Mercado Livre.");
  });
});
