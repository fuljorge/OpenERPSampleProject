import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialKeyRecord } from "../repositories/credential-key.repository.js";

const store = vi.hoisted(() => ({ keys: new Map<string, CredentialKeyRecord>() }));

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
vi.mock("../database/mongo.client.js", () => ({ getDb: () => ({}) }));

const { decryptCredential, encryptCredential, getCredentialKeyId, maskCredential } = await import(
  "./credential-encryption.service.js"
);
const { CredentialKeyRotationConflictError, createNextCredentialKey, getActiveKeyInfo } = await import(
  "./credential-key.service.js"
);

const MASTER_ENV = "MARKETPLACE_CREDENTIAL_MASTER_KEY";
const newMasterKey = () => randomBytes(32).toString("base64");

describe("credential-encryption.service (envelope — ADR-021)", () => {
  const original = process.env[MASTER_ENV];

  beforeEach(() => {
    store.keys.clear();
    process.env[MASTER_ENV] = newMasterKey();
  });

  afterEach(() => {
    if (original === undefined) delete process.env[MASTER_ENV];
    else process.env[MASTER_ENV] = original;
  });

  it("encrypt/decrypt: round-trip recupera o valor original", async () => {
    const plain = "APP_USR-1234567890-abcdef";
    expect(await decryptCredential(await encryptCredential(plain))).toBe(plain);
  });

  it("cria a primeira chave de dados sozinho (ninguém gera chave à mão)", async () => {
    expect(store.keys.size).toBe(0);
    const ciphertext = await encryptCredential("x");

    expect(store.keys.size).toBe(1);
    expect(getCredentialKeyId(ciphertext)).toBe("k1");
  });

  it("encrypt nunca retorna o texto puro, e dois ciphertexts do mesmo valor são diferentes (IV aleatório)", async () => {
    const a = await encryptCredential("mesma-credencial");
    const b = await encryptCredential("mesma-credencial");
    expect(a).not.toContain("mesma-credencial");
    expect(a).not.toBe(b);
  });

  it("decrypt falha para ciphertext adulterado, malformado ou de chave inexistente", async () => {
    const [keyId, iv, tag] = (await encryptCredential("valor")).split(":");

    await expect(
      decryptCredential([keyId, iv, tag, Buffer.from("adulterado").toString("base64")].join(":")),
    ).rejects.toThrow();
    await expect(decryptCredential("sem-o-formato-esperado")).rejects.toThrow(/inválido/);
    await expect(decryptCredential(["k99", iv, tag, "AAAA"].join(":"))).rejects.toThrow(/"k99" não existe/);
  });

  it("maskCredential mantém só os últimos 4 caracteres visíveis", () => {
    expect(maskCredential("APP_USR-1234567890-abcdef")).toBe("****cdef");
  });

  describe("chave-mestra e chaves de dados", () => {
    it("a chave de dados nunca fica utilizável sozinha no banco: sem a chave-mestra certa, não abre", async () => {
      const ciphertext = await encryptCredential("segredo");
      expect(store.keys.get("k1")?.wrappedKey).not.toContain(process.env[MASTER_ENV] as string);

      process.env[MASTER_ENV] = newMasterKey(); // chave-mestra errada
      await expect(decryptCredential(ciphertext)).rejects.toThrow(/Não foi possível abrir a chave.*"k1"/);
    });

    it("uma chave embrulhada copiada para outro registro não abre (id autenticado como AAD)", async () => {
      await encryptCredential("x");
      await createNextCredentialKey("admin-1");
      const ciphertextUnderK2 = await encryptCredential("y");

      const k1 = store.keys.get("k1") as CredentialKeyRecord;
      const k2 = store.keys.get("k2") as CredentialKeyRecord;
      store.keys.set("k2", { ...k2, wrappedKey: k1.wrappedKey });

      await expect(decryptCredential(ciphertextUnderK2)).rejects.toThrow(/Não foi possível abrir.*"k2"/);
    });

    it("exige a chave-mestra configurada e com 32 bytes", async () => {
      delete process.env[MASTER_ENV];
      await expect(encryptCredential("x")).rejects.toThrow(/não configurada/);

      process.env[MASTER_ENV] = Buffer.from("curta").toString("base64");
      await expect(encryptCredential("x")).rejects.toThrow(/32 bytes/);
    });
  });

  describe("rotação da chave de dados", () => {
    it("a nova versão passa a ser a ativa; valores da chave antiga continuam legíveis", async () => {
      const oldCiphertext = await encryptCredential("segredo");

      const { previous, next } = await createNextCredentialKey("admin-1");
      expect(previous.id).toBe("k1");
      expect(next.id).toBe("k2");
      expect((await getActiveKeyInfo()).id).toBe("k2");

      expect(getCredentialKeyId(await encryptCredential("novo"))).toBe("k2");
      expect(await decryptCredential(oldCiphertext)).toBe("segredo");
    });

    it("duas rotações simultâneas: a segunda recebe conflito, sem criar chave duplicada", async () => {
      await encryptCredential("x");
      const results = await Promise.allSettled([createNextCredentialKey("a"), createNextCredentialKey("b")]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(CredentialKeyRotationConflictError);
      expect(store.keys.size).toBe(2);
    });
  });
});
