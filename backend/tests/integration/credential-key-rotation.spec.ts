import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hashPassword } from "../../src/services/password.service.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;
let adminCookie: string;
let operatorCookie: string;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };
const OPERATOR = { email: "operador@example.com", password: "senha-operador-123" };

async function loginAs(credentials: { email: string; password: string }) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: credentials });
  return response.cookies.find((c) => c.name === "accessToken")!.value;
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.MARKETPLACE_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");

  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const mongoClientModule = await import("../../src/database/mongo.client.js");
  disconnectMongo = mongoClientModule.disconnectMongo;
  const db = await mongoClientModule.connectMongo();

  const base = { status: "active", lastLoginAt: null, createdAt: new Date(), updatedAt: new Date(), createdBy: null };
  await db.collection("users").insertMany([
    { name: "Administradora", email: ADMIN.email, passwordHash: await hashPassword(ADMIN.password), role: "admin", ...base },
    { name: "Operador", email: OPERATOR.email, passwordHash: await hashPassword(OPERATOR.password), role: "operator", ...base },
  ]);

  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });

  adminCookie = await loginAs(ADMIN);
  operatorCookie = await loginAs(OPERATOR);
}, 60_000);

afterAll(async () => {
  await app.close();
  await disconnectMongo();
  await mongoServer.stop();
});

async function createAccount(label: string, credential: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts",
    cookies: { accessToken: adminCookie },
    payload: { marketplace: "shopee", label, credential },
  });
  return response.json().data.id as string;
}

async function storedCiphertext(id: string) {
  const { getDb } = await import("../../src/database/mongo.client.js");
  const { ObjectId } = await import("mongodb");
  const doc = await getDb().collection("marketplace_accounts").findOne({ _id: new ObjectId(id) });
  return doc!.credential as string;
}

describe("botão 'Rotacionar chave de criptografia' (spec 011, seção 3.1; ADR-021)", () => {
  it("só admin vê o status e rotaciona: operator recebe 403, sem sessão 401", async () => {
    for (const [method, url] of [
      ["GET", "/api/marketplace-accounts/encryption-key"],
      ["POST", "/api/marketplace-accounts/rotate-key"],
    ] as const) {
      const asOperator = await app.inject({ method, url, cookies: { accessToken: operatorCookie } });
      expect(asOperator.statusCode).toBe(403);
      const anonymous = await app.inject({ method, url });
      expect(anonymous.statusCode).toBe(401);
    }
  });

  it("fluxo completo: a primeira chave nasce sozinha, a rotação re-cifra tudo e nenhuma credencial se perde", async () => {
    const idOne = await createAccount("Loja 1", "credencial-um");
    const idTwo = await createAccount("Loja 2", "credencial-dois");
    expect((await storedCiphertext(idOne)).startsWith("k1:")).toBe(true);

    const before = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts/encryption-key",
      cookies: { accessToken: adminCookie },
    });
    expect(before.json().data).toMatchObject({ activeKey: { id: "k1", version: 1 }, accountsByKeyId: { k1: 2 } });

    const rotate = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts/rotate-key",
      cookies: { accessToken: adminCookie },
    });
    expect(rotate.statusCode).toBe(200);
    expect(rotate.json().data).toMatchObject({ previousKeyId: "k1", newKeyId: "k2", total: 2, rotated: 2, failed: [] });

    expect((await storedCiphertext(idOne)).startsWith("k2:")).toBe(true);
    const after = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts/encryption-key",
      cookies: { accessToken: adminCookie },
    });
    expect(after.json().data).toMatchObject({ activeKey: { id: "k2" }, accountsByKeyId: { k2: 2 } });

    // As credenciais originais continuam recuperáveis (é o que o conector usa ao publicar).
    const { getActiveMarketplaceAccountForConnector } = await import(
      "../../src/services/marketplace-account.service.js"
    );
    expect((await getActiveMarketplaceAccountForConnector(idOne)).credential).toBe("credencial-um");
    expect((await getActiveMarketplaceAccountForConnector(idTwo)).credential).toBe("credencial-dois");

    // Contas criadas depois já nascem sob a chave nova.
    const idNew = await createAccount("Loja 3", "credencial-tres");
    expect((await storedCiphertext(idNew)).startsWith("k2:")).toBe(true);
  });

  it("a chave de dados nunca fica em texto puro no banco", async () => {
    const { getDb } = await import("../../src/database/mongo.client.js");
    const keys = await getDb().collection("credential_keys").find().toArray();

    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const key of keys) {
      // 3 partes base64 (iv:tag:dados) — nunca os 32 bytes crus da chave de dados
      expect((key.wrappedKey as string).split(":")).toHaveLength(3);
    }
  });

  it("a rotação gera auditoria com o admin responsável e sem credenciais", async () => {
    const audit = await app.inject({
      method: "GET",
      url: "/api/audit-logs?action=MARKETPLACE_CREDENTIAL_KEY_ROTATE",
      cookies: { accessToken: adminCookie },
    });

    const items = audit.json().data.items;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].userId).toBeTruthy();
    expect(JSON.stringify(items)).not.toContain("credencial-");
  });
});

describe("rotação × trava por conta (spec 012, seção 2.3)", () => {
  it("conta ocupada por uma operação do conector é pulada; a rotação seguinte a alcança e a credencial segue legível", async () => {
    const busyId = await createAccount("Loja ocupada", "credencial-ocupada");
    const { tryAcquireAccountLease } = await import("../../src/services/account-operation.service.js");
    const release = (await tryAcquireAccountLease(busyId))!;
    const before = await storedCiphertext(busyId);

    const first = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts/rotate-key",
      cookies: { accessToken: adminCookie },
    });
    expect(first.json().data.skippedConcurrent).toBeGreaterThanOrEqual(1);
    expect(await storedCiphertext(busyId)).toBe(before); // não foi re-cifrada

    await release();
    const second = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts/rotate-key",
      cookies: { accessToken: adminCookie },
    });
    expect((await storedCiphertext(busyId)).startsWith(`${second.json().data.newKeyId}:`)).toBe(true);

    const { getActiveMarketplaceAccountForConnector } = await import("../../src/services/marketplace-account.service.js");
    expect((await getActiveMarketplaceAccountForConnector(busyId)).credential).toBe("credencial-ocupada");
  });
});
