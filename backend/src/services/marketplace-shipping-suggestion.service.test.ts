import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceAccountRecord } from "../repositories/marketplace-account.repository.js";

const getProductByIdMock = vi.fn();
const findByIdMock = vi.fn();
const runAccountOperationMock = vi.fn();
const suggestShippingMock = vi.fn();

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
  suggestShipping: (...args: unknown[]) => suggestShippingMock(...args),
}));

// `runAccountOperation` fica mockado, mas as demais exportações (AccountBusyError) são as reais.
vi.mock("./account-operation.service.js", async () => {
  const actual = await vi.importActual<typeof import("./account-operation.service.js")>("./account-operation.service.js");
  return { ...actual, runAccountOperation: (...args: unknown[]) => runAccountOperationMock(...args) };
});

const { suggestShippingOptions, MarketplaceShippingSuggestionUnsupportedError } = await import("./marketplace-shipping-suggestion.service.js");
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

const OPTIONS = [{ mode: "me2", logisticType: "self_service", isDefault: true, freeShippingRequired: true, freeShippingAllowed: true }];
const BASE_INPUT = { productId: "p1", marketplace: "mercado_livre" as const, accountId: "acc-1", categoryId: "MLB188064", listingTypeId: "free" };

beforeEach(() => {
  getProductByIdMock.mockReset().mockResolvedValue({ preco: { preco_venda: 89.9 } });
  findByIdMock.mockReset().mockResolvedValue(makeAccount());
  runAccountOperationMock.mockReset();
  suggestShippingMock.mockReset();
});

describe("marketplace-shipping-suggestion.service.suggestShippingOptions (spec 012; achado real 24/09/2026)", () => {
  it("marketplace diferente de mercado_livre: MarketplaceShippingSuggestionUnsupportedError, sem consultar nada", async () => {
    await expect(suggestShippingOptions({ ...BASE_INPUT, marketplace: "shopee" })).rejects.toThrow(
      MarketplaceShippingSuggestionUnsupportedError,
    );
    expect(getProductByIdMock).not.toHaveBeenCalled();
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("conta inexistente ou inativa: MarketplaceAccountNotFoundError", async () => {
    findByIdMock.mockResolvedValue(null);
    await expect(suggestShippingOptions(BASE_INPUT)).rejects.toThrow(MarketplaceAccountNotFoundError);

    findByIdMock.mockResolvedValue(makeAccount({ active: false }));
    await expect(suggestShippingOptions(BASE_INPUT)).rejects.toThrow(MarketplaceAccountNotFoundError);
  });

  it("conta de outro marketplace: MarketplaceAccountMismatchError", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ marketplace: "shopee" }));
    await expect(suggestShippingOptions(BASE_INPUT)).rejects.toThrow(MarketplaceAccountMismatchError);
  });

  it("sucesso: devolve as opções do conector, com categoria e tipo de anúncio já escolhidos na revisão", async () => {
    runAccountOperationMock.mockImplementation(
      async (_id: string, op: (ctx: { account: unknown; credential: string }) => Promise<{ value: unknown }>) => {
        const outcome = await op({ account: makeAccount(), credential: "plain-credential" });
        return outcome.value;
      },
    );
    suggestShippingMock.mockResolvedValue({ value: OPTIONS });

    const result = await suggestShippingOptions(BASE_INPUT);

    expect(suggestShippingMock).toHaveBeenCalledWith("plain-credential", { preco: { preco_venda: 89.9 } }, "MLB188064", "free");
    expect(result).toEqual(OPTIONS);
  });

  it("conta ocupada por outra operação (AccountBusyError): propaga", async () => {
    runAccountOperationMock.mockRejectedValue(new AccountBusyError());
    await expect(suggestShippingOptions(BASE_INPUT)).rejects.toThrow(AccountBusyError);
  });

  it("falha real (rede, token, Mercado Livre fora do ar): propaga — diferente da sugestão de categoria, não é uma previsão dispensável", async () => {
    runAccountOperationMock.mockRejectedValue(new Error("Falha ao falar com o Mercado Livre."));
    await expect(suggestShippingOptions(BASE_INPUT)).rejects.toThrow("Falha ao falar com o Mercado Livre.");
  });
});
