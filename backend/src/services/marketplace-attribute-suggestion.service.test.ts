import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceAccountRecord } from "../repositories/marketplace-account.repository.js";

const getProductByIdMock = vi.fn();
const findByIdMock = vi.fn();
const runAccountOperationMock = vi.fn();
const suggestAttributesMock = vi.fn();

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
  suggestAttributes: (...args: unknown[]) => suggestAttributesMock(...args),
}));

vi.mock("./account-operation.service.js", async () => {
  const actual = await vi.importActual<typeof import("./account-operation.service.js")>("./account-operation.service.js");
  return { ...actual, runAccountOperation: (...args: unknown[]) => runAccountOperationMock(...args) };
});

const { suggestRequiredAttributes, MarketplaceAttributeSuggestionUnsupportedError } = await import("./marketplace-attribute-suggestion.service.js");
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

const PENDING = [{ id: "GARMENT_TYPE", name: "Tipo de roupa", valueType: "list", options: [{ id: "G2", name: "Blazer" }], suggested: null }];
const BASE_INPUT = { productId: "p1", marketplace: "mercado_livre" as const, accountId: "acc-1", categoryId: "MLB108803" };

beforeEach(() => {
  getProductByIdMock.mockReset().mockResolvedValue({ sku: "ERP-JAQU-000001" });
  findByIdMock.mockReset().mockResolvedValue(makeAccount());
  runAccountOperationMock.mockReset();
  suggestAttributesMock.mockReset();
});

describe("marketplace-attribute-suggestion.service.suggestRequiredAttributes (ADR-035)", () => {
  it("marketplace diferente de mercado_livre: erro, sem consultar nada", async () => {
    await expect(suggestRequiredAttributes({ ...BASE_INPUT, marketplace: "shopee" })).rejects.toThrow(MarketplaceAttributeSuggestionUnsupportedError);
    expect(getProductByIdMock).not.toHaveBeenCalled();
  });

  it("conta inexistente/inativa ou de outro marketplace: erro", async () => {
    findByIdMock.mockResolvedValue(null);
    await expect(suggestRequiredAttributes(BASE_INPUT)).rejects.toThrow(MarketplaceAccountNotFoundError);

    findByIdMock.mockResolvedValue(makeAccount({ marketplace: "shopee" }));
    await expect(suggestRequiredAttributes(BASE_INPUT)).rejects.toThrow(MarketplaceAccountMismatchError);
  });

  it("sucesso: devolve os pendentes do conector, com a categoria já escolhida na revisão", async () => {
    runAccountOperationMock.mockImplementation(
      async (_id: string, op: (ctx: { account: unknown; credential: string }) => Promise<{ value: unknown }>) =>
        (await op({ account: makeAccount(), credential: "plain-credential" })).value,
    );
    suggestAttributesMock.mockResolvedValue({ value: PENDING });

    const result = await suggestRequiredAttributes(BASE_INPUT);

    expect(suggestAttributesMock).toHaveBeenCalledWith("plain-credential", { sku: "ERP-JAQU-000001" }, "MLB108803");
    expect(result).toEqual(PENDING);
  });
});
