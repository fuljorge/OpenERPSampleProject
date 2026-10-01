import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialKeyRecord } from "../repositories/credential-key.repository.js";
import type { MarketplaceAccountRecord } from "../repositories/marketplace-account.repository.js";

const store = vi.hoisted(() => ({ keys: new Map<string, CredentialKeyRecord>() }));
const listMock = vi.fn();
const replaceMock = vi.fn();
const recordMock = vi.fn();
const leaseMock = vi.fn();
const releaseMock = vi.fn();

vi.mock("../repositories/credential-key.repository.js", () => ({
  isDuplicateKeyError: (err: unknown) => (err as { code?: number })?.code === 11000,
  credentialKeyRepository: {
    findLatest: async () => [...store.keys.values()].sort((a, b) => b.version - a.version)[0] ?? null,
    findById: async (_db: unknown, id: string) => store.keys.get(id) ?? null,
    insert: async (_db: unknown, record: CredentialKeyRecord) => {
      if (store.keys.has(record.id)) throw Object.assign(new Error("dup"), { code: 11000 });
      store.keys.set(record.id, record);
    },
  },
}));
vi.mock("../repositories/marketplace-account.repository.js", () => ({
  marketplaceAccountRepository: {
    list: (...args: unknown[]) => listMock(...args),
    replaceCredentialCiphertext: (...args: unknown[]) => replaceMock(...args),
    acquireOperationLease: (...args: unknown[]) => leaseMock(...args),
    releaseOperationLease: (...args: unknown[]) => releaseMock(...args),
  },
}));
vi.mock("./audit-log.service.js", () => ({ record: (...args: unknown[]) => recordMock(...args) }));
vi.mock("../database/mongo.client.js", () => ({ getDb: () => ({}) }));

const { decryptCredential, encryptCredential, getCredentialKeyId } = await import(
  "./credential-encryption.service.js"
);
const { rotateCredentialKey, getEncryptionKeyStatus } = await import("./credential-key-rotation.service.js");

const MASTER_ENV = "MARKETPLACE_CREDENTIAL_MASTER_KEY";

function makeAccount(id: string, credential: string): MarketplaceAccountRecord {
  return {
    id,
    marketplace: "mercado_livre",
    label: id,
    credential,
    credentialPreview: "****abcd",
    connectionStatus: "connected",
    active: true,
    createdBy: "admin-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    expectedUser: null,
    connectedUserId: null,
    connectedNickname: null,
  };
}

describe("credential-key-rotation.service", () => {
  const original = process.env[MASTER_ENV];

  beforeEach(() => {
    store.keys.clear();
    process.env[MASTER_ENV] = randomBytes(32).toString("base64");
    listMock.mockReset();
    replaceMock.mockReset().mockResolvedValue(true);
    recordMock.mockReset().mockResolvedValue(undefined);
    leaseMock.mockReset().mockResolvedValue(true);
    releaseMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (original === undefined) delete process.env[MASTER_ENV];
    else process.env[MASTER_ENV] = original;
  });

  it("cria a nova chave, re-cifra as contas para ela e preserva os valores originais", async () => {
    const accounts = [
      makeAccount("acc-0", await encryptCredential("segredo-0")),
      makeAccount("acc-1", await encryptCredential("segredo-1")),
    ];
    listMock.mockResolvedValue(accounts);

    const report = await rotateCredentialKey("admin-1");

    expect(report).toMatchObject({ previousKeyId: "k1", newKeyId: "k2", total: 2, rotated: 2, alreadyCurrent: 0 });
    expect(report.failed).toEqual([]);
    const [, id, expected, next] = replaceMock.mock.calls[0] as [unknown, string, string, string];
    expect(id).toBe("acc-0");
    expect(expected).toBe(accounts[0]?.credential);
    expect(getCredentialKeyId(next)).toBe("k2");
    expect(await decryptCredential(next)).toBe("segredo-0");
  });

  it("uma conta que falha (ciphertext corrompido) é reportada e não interrompe as demais", async () => {
    listMock.mockResolvedValue([
      makeAccount("acc-ruim", "k1:AAAA:AAAA:AAAA"),
      makeAccount("acc-ok", await encryptCredential("ok")),
    ]);

    const report = await rotateCredentialKey("admin-1");

    expect(report.rotated).toBe(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.accountId).toBe("acc-ruim");
  });

  it("conta ocupada por uma operação do conector (trava por conta) é pulada, sem re-cifrar", async () => {
    listMock.mockResolvedValue([
      makeAccount("acc-ocupada", await encryptCredential("a")),
      makeAccount("acc-livre", await encryptCredential("b")),
    ]);
    leaseMock.mockImplementation(async (_db: unknown, id: string) => id !== "acc-ocupada");

    const report = await rotateCredentialKey("admin-1");

    expect(report).toMatchObject({ total: 2, rotated: 1, skippedConcurrent: 1 });
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect((replaceMock.mock.calls[0] as unknown[])[1]).toBe("acc-livre");
  });

  it("solta a trava de cada conta que obteve, inclusive a que falha ao re-cifrar", async () => {
    listMock.mockResolvedValue([
      makeAccount("acc-ruim", "k1:AAAA:AAAA:AAAA"),
      makeAccount("acc-ok", await encryptCredential("ok")),
    ]);

    await rotateCredentialKey("admin-1");

    expect(releaseMock.mock.calls.map((call) => (call as unknown[])[1])).toEqual(["acc-ruim", "acc-ok"]);
  });

  it("conta editada durante a rotação (atualização condicional não casa) é ignorada, não sobrescrita", async () => {
    listMock.mockResolvedValue([makeAccount("acc-0", await encryptCredential("x"))]);
    replaceMock.mockResolvedValue(false);

    expect(await rotateCredentialKey("admin-1")).toMatchObject({ rotated: 0, skippedConcurrent: 1 });
  });

  it("audita a rotação com o admin responsável, sem credenciais no metadata", async () => {
    listMock.mockResolvedValue([makeAccount("acc-0", await encryptCredential("segredo-secreto"))]);

    await rotateCredentialKey("admin-1");

    expect(recordMock).toHaveBeenCalledWith(
      "MARKETPLACE_CREDENTIAL_KEY_ROTATE",
      "marketplace_account",
      undefined,
      "admin-1",
      expect.objectContaining({ previousKeyId: "k1", newKeyId: "k2", rotated: 1, failed: 0 }),
    );
    expect(JSON.stringify(recordMock.mock.calls[0]?.[4])).not.toContain("segredo");
  });

  it("status: chave ativa e quantas contas há em cada chave", async () => {
    listMock.mockResolvedValue([makeAccount("a", await encryptCredential("1"))]);
    await rotateCredentialKey("admin-1");
    listMock.mockResolvedValue([
      makeAccount("a", await encryptCredential("1")), // já na chave nova
      makeAccount("b", "k1:iv:tag:data"), // ainda na antiga
    ]);

    const status = await getEncryptionKeyStatus();

    expect(status.activeKey.id).toBe("k2");
    expect(status.accountsByKeyId).toEqual({ k2: 1, k1: 1 });
  });
});
