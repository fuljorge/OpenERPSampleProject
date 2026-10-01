import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { MarketplaceAccountRecord } from "../repositories/marketplace-account.repository.js";

const findByIdMock = vi.fn();
const listMock = vi.fn();
const createMock = vi.fn();
const updateProfileMock = vi.fn();
const updateStatusMock = vi.fn();
const markDisconnectedMock = vi.fn();
const deleteMock = vi.fn();
const countPublishedMock = vi.fn();
const recordMock = vi.fn();
const encryptMock = vi.fn();
const decryptMock = vi.fn();
const maskMock = vi.fn();

vi.mock("../repositories/marketplace-account.repository.js", () => ({
  marketplaceAccountRepository: {
    findById: (...args: unknown[]) => findByIdMock(...args),
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    updateProfile: (...args: unknown[]) => updateProfileMock(...args),
    updateStatus: (...args: unknown[]) => updateStatusMock(...args),
    markDisconnected: (...args: unknown[]) => markDisconnectedMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}));

vi.mock("../repositories/product.repository.js", () => ({
  productRepository: {
    countPublishedListingsByAccount: (...args: unknown[]) => countPublishedMock(...args),
  },
}));

vi.mock("./audit-log.service.js", () => ({
  record: (...args: unknown[]) => recordMock(...args),
}));

vi.mock("./credential-encryption.service.js", () => ({
  encryptCredential: (...args: unknown[]) => encryptMock(...args),
  decryptCredential: (...args: unknown[]) => decryptMock(...args),
  maskCredential: (...args: unknown[]) => maskMock(...args),
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

const {
  createMarketplaceAccount,
  listMarketplaceAccounts,
  updateMarketplaceAccountStatus,
  disconnectMarketplaceAccount,
  deleteMarketplaceAccount,
  getActiveMarketplaceAccountForConnector,
  MarketplaceAccountLifecycleError,
  MarketplaceAccountNotFoundError,
} = await import("./marketplace-account.service.js");

function makeAccount(overrides: Partial<MarketplaceAccountRecord> = {}): MarketplaceAccountRecord {
  return {
    id: "acc-1",
    marketplace: "mercado_livre",
    label: "Loja Demo - Loja 1",
    credential: "encrypted-value",
    credentialPreview: "****cdef",
    connectionStatus: "disconnected",
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

beforeEach(() => {
  findByIdMock.mockReset();
  listMock.mockReset();
  createMock.mockReset();
  updateProfileMock.mockReset();
  updateStatusMock.mockReset();
  markDisconnectedMock.mockReset();
  deleteMock.mockReset().mockResolvedValue(true);
  countPublishedMock.mockReset().mockResolvedValue(new Map());
  recordMock.mockReset().mockResolvedValue(undefined);
  encryptMock.mockReset().mockReturnValue("encrypted-value");
  decryptMock.mockReset().mockReturnValue("plain-credential");
  maskMock.mockReset().mockReturnValue("****cdef");
});

describe("marketplace-account.service.createMarketplaceAccount", () => {
  it("criptografa a credencial antes de persistir e nunca retorna o valor completo", async () => {
    createMock.mockResolvedValue(makeAccount());

    const result = await createMarketplaceAccount({
      marketplace: "shopee",
      label: "Loja Demo - Loja 1",
      credential: "APP_USR-abcdef",
      actingAdminId: "admin-1",
    });

    expect(encryptMock).toHaveBeenCalledWith("APP_USR-abcdef");
    expect(maskMock).toHaveBeenCalledWith("APP_USR-abcdef");
    expect(createMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credential: "encrypted-value", credentialPreview: "****cdef" }),
    );
    expect(result).not.toHaveProperty("credential");
    expect(result.credentialPreview).toBe("****cdef");
    expect(recordMock).toHaveBeenCalledWith(
      "MARKETPLACE_ACCOUNT_CREATE",
      "marketplace_account",
      "acc-1",
      "admin-1",
      expect.objectContaining({ marketplace: "mercado_livre" }),
    );
  });
});

describe("marketplace-account.service.listMarketplaceAccounts", () => {
  it("nunca inclui o valor completo de credential e audita uma visualização", async () => {
    listMock.mockResolvedValue([makeAccount(), makeAccount({ id: "acc-2" })]);

    const result = await listMarketplaceAccounts({}, "admin-1");

    expect(result).toHaveLength(2);
    for (const account of result) {
      expect(account).not.toHaveProperty("credential");
    }
    expect(recordMock).toHaveBeenCalledWith(
      "MARKETPLACE_ACCOUNT_VIEW",
      "marketplace_account",
      undefined,
      "admin-1",
      expect.objectContaining({ count: 2 }),
    );
  });
});

describe("marketplace-account.service.updateMarketplaceAccountStatus", () => {
  it("desativar gera MARKETPLACE_ACCOUNT_DISABLE", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ active: true }));

    await updateMarketplaceAccountStatus("acc-1", false, "admin-1");

    expect(updateStatusMock).toHaveBeenCalledWith(expect.anything(), "acc-1", false);
    expect(recordMock).toHaveBeenCalledWith(
      "MARKETPLACE_ACCOUNT_DISABLE",
      "marketplace_account",
      "acc-1",
      "admin-1",
      expect.objectContaining({ oldValue: true, newValue: false }),
    );
  });

  it("reativar gera MARKETPLACE_ACCOUNT_UPDATE, não DISABLE", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ active: false }));

    await updateMarketplaceAccountStatus("acc-1", true, "admin-1");

    expect(recordMock).toHaveBeenCalledWith(
      "MARKETPLACE_ACCOUNT_UPDATE",
      "marketplace_account",
      "acc-1",
      "admin-1",
      expect.anything(),
    );
  });

  it("lança MarketplaceAccountNotFoundError para conta inexistente", async () => {
    findByIdMock.mockResolvedValue(null);
    await expect(updateMarketplaceAccountStatus("nope", false, "admin-1")).rejects.toThrow(
      MarketplaceAccountNotFoundError,
    );
  });
});

describe("marketplace-account.service.getActiveMarketplaceAccountForConnector", () => {
  it("decripta a credencial em memória para uma conta ativa", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ active: true, credential: "encrypted-value" }));

    const result = await getActiveMarketplaceAccountForConnector("acc-1");

    expect(decryptMock).toHaveBeenCalledWith("encrypted-value");
    expect(result.credential).toBe("plain-credential");
    // Não deve auditar MARKETPLACE_ACCOUNT_VIEW aqui — esse evento cobre visualização/gestão
    // administrativa, não o uso interno da credencial pelo conector durante a publicação.
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("lança MarketplaceAccountNotFoundError para conta inativa", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ active: false }));
    await expect(getActiveMarketplaceAccountForConnector("acc-1")).rejects.toThrow(
      MarketplaceAccountNotFoundError,
    );
  });

  it("lança MarketplaceAccountNotFoundError para conta inexistente", async () => {
    findByIdMock.mockResolvedValue(null);
    await expect(getActiveMarketplaceAccountForConnector("nope")).rejects.toThrow(
      MarketplaceAccountNotFoundError,
    );
  });
});

describe("marketplace-account.service — Desativar exige conta desconectada (spec 011, seção 2.2.2)", () => {
  it.each(["connected", "error", "expired"] as const)("recusa desativar conta %s", async (connectionStatus) => {
    findByIdMock.mockResolvedValue(makeAccount({ connectionStatus }));

    await expect(updateMarketplaceAccountStatus("acc-1", false, "admin-1")).rejects.toThrow(
      MarketplaceAccountLifecycleError,
    );
    expect(updateStatusMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("reativar não exige nada — vale mesmo para conta que ficou conectada por dados antigos", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ active: false, connectionStatus: "connected" }));

    await updateMarketplaceAccountStatus("acc-1", true, "admin-1");

    expect(updateStatusMock).toHaveBeenCalledWith(expect.anything(), "acc-1", true);
  });
});

describe("marketplace-account.service.disconnectMarketplaceAccount", () => {
  it("Mercado Livre: regrava a credencial só com Client ID/Secret (descarta os tokens) e audita", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ connectionStatus: "connected" }));
    decryptMock.mockResolvedValue(
      JSON.stringify({
        client_id: "123",
        client_secret: "segredo",
        access_token: "APP_USR-x",
        refresh_token: "TG-y",
        expires_at: "2026-09-21T20:00:00.000Z",
        user_id: 42,
      }),
    );
    encryptMock.mockResolvedValue("ciphertext-sem-tokens");

    await disconnectMarketplaceAccount("acc-1", "admin-1");

    expect(JSON.parse(encryptMock.mock.calls[0]![0] as string)).toEqual({ client_id: "123", client_secret: "segredo" });
    expect(markDisconnectedMock).toHaveBeenCalledWith(expect.anything(), "acc-1", "ciphertext-sem-tokens");
    expect(recordMock).toHaveBeenCalledWith(
      "MARKETPLACE_ACCOUNT_DISCONNECT",
      "marketplace_account",
      "acc-1",
      "admin-1",
      { previousConnectionStatus: "connected" },
    );
  });

  it("outro marketplace: só muda o status de conexão, sem tocar na credencial", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ marketplace: "shopee", connectionStatus: "error" }));

    await disconnectMarketplaceAccount("acc-1", "admin-1");

    expect(decryptMock).not.toHaveBeenCalled();
    expect(markDisconnectedMock).toHaveBeenCalledWith(expect.anything(), "acc-1", undefined);
  });

  it("credencial do Mercado Livre em formato inesperado é mantida como está", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ connectionStatus: "connected" }));
    decryptMock.mockResolvedValue("texto-solto");

    await disconnectMarketplaceAccount("acc-1", "admin-1");

    expect(encryptMock).not.toHaveBeenCalled();
    expect(markDisconnectedMock).toHaveBeenCalledWith(expect.anything(), "acc-1", undefined);
  });

  it("lança MarketplaceAccountNotFoundError para conta inexistente", async () => {
    findByIdMock.mockResolvedValue(null);
    await expect(disconnectMarketplaceAccount("nope", "admin-1")).rejects.toThrow(MarketplaceAccountNotFoundError);
  });
});

describe("marketplace-account.service.deleteMarketplaceAccount", () => {
  it("apaga conta desconectada e desativada e audita só marketplace/apelido", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ active: false, connectionStatus: "disconnected" }));

    await deleteMarketplaceAccount("acc-1", "admin-1");

    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), "acc-1");
    expect(recordMock).toHaveBeenCalledWith(
      "MARKETPLACE_ACCOUNT_DELETE",
      "marketplace_account",
      "acc-1",
      "admin-1",
      { marketplace: "mercado_livre", label: "Loja Demo - Loja 1" },
    );
    expect(JSON.stringify(recordMock.mock.calls)).not.toContain("encrypted-value");
  });

  it("recusa apagar conta ainda ativa (pede desativar)", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ active: true, connectionStatus: "disconnected" }));

    await expect(deleteMarketplaceAccount("acc-1", "admin-1")).rejects.toThrow(/Desative a conta/);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("recusa apagar conta ainda conectada (pede desconectar primeiro), mesmo se já inativa", async () => {
    findByIdMock.mockResolvedValue(makeAccount({ active: false, connectionStatus: "connected" }));

    await expect(deleteMarketplaceAccount("acc-1", "admin-1")).rejects.toThrow(/Desconecte/);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("lança MarketplaceAccountNotFoundError para conta inexistente ou apagada em paralelo", async () => {
    findByIdMock.mockResolvedValue(null);
    await expect(deleteMarketplaceAccount("nope", "admin-1")).rejects.toThrow(MarketplaceAccountNotFoundError);

    findByIdMock.mockResolvedValue(makeAccount({ active: false }));
    deleteMock.mockResolvedValue(false);
    await expect(deleteMarketplaceAccount("acc-1", "admin-1")).rejects.toThrow(MarketplaceAccountNotFoundError);
    expect(recordMock).not.toHaveBeenCalled();
  });
});

describe("marketplace-account.service — publishedListingsCount (spec 011, seção 2.2.2)", () => {
  it("listar traz a contagem de anúncios publicados de cada conta, com 0 para quem não tem", async () => {
    listMock.mockResolvedValue([makeAccount({ id: "acc-1" }), makeAccount({ id: "acc-2" }), makeAccount({ id: "acc-3" })]);
    countPublishedMock.mockResolvedValue(new Map([["acc-1", 4], ["acc-3", 1]]));

    const result = await listMarketplaceAccounts({}, "admin-1");

    expect(result.map((account) => account.publishedListingsCount)).toEqual([4, 0, 1]);
  });

  it("faz um único aggregate para toda a listagem (não um por conta)", async () => {
    listMock.mockResolvedValue([makeAccount({ id: "acc-1" }), makeAccount({ id: "acc-2" })]);

    await listMarketplaceAccounts({}, "admin-1");

    expect(countPublishedMock).toHaveBeenCalledTimes(1);
  });

  it("as demais respostas de conta (criar, desconectar, ativar) também trazem a contagem", async () => {
    countPublishedMock.mockResolvedValue(new Map([["acc-1", 2]]));
    createMock.mockResolvedValue(makeAccount({ id: "acc-1" }));
    findByIdMock.mockResolvedValue(makeAccount({ id: "acc-1", connectionStatus: "connected" }));
    decryptMock.mockResolvedValue("texto-solto");

    const created = await createMarketplaceAccount({
      marketplace: "shopee",
      label: "Loja",
      credential: "api-key",
      actingAdminId: "admin-1",
    });
    const disconnected = await disconnectMarketplaceAccount("acc-1", "admin-1");
    const reactivated = await updateMarketplaceAccountStatus("acc-1", true, "admin-1");

    expect([created, disconnected, reactivated].map((account) => account.publishedListingsCount)).toEqual([2, 2, 2]);
  });

  it("nunca vaza a credencial junto da contagem", async () => {
    listMock.mockResolvedValue([makeAccount({ id: "acc-1", credential: "SEGREDO-CIFRADO" })]);

    const result = await listMarketplaceAccounts({}, "admin-1");

    expect(JSON.stringify(result)).not.toContain("SEGREDO-CIFRADO");
  });
});
