import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hashPassword } from "../../src/services/password.service.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;
let adminCookie: string;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };

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

  await db.collection("users").insertOne({
    name: "Administradora",
    email: ADMIN.email,
    passwordHash: await hashPassword(ADMIN.password),
    role: "admin",
    status: "active",
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
  });

  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });
  adminCookie = await loginAs(ADMIN);
}, 60_000);

afterAll(async () => {
  await app.close();
  await disconnectMongo();
  await mongoServer.stop();
});

async function createAccount(label: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts",
    cookies: { accessToken: adminCookie },
    payload: { marketplace: "shopee", label, credential: `credencial-${label}` },
  });
  return response.json().data.id as string;
}

async function listCounts() {
  const response = await app.inject({
    method: "GET",
    url: "/api/marketplace-accounts",
    cookies: { accessToken: adminCookie },
  });
  const counts: Record<string, number> = {};
  for (const account of response.json().data as { label: string; publishedListingsCount: number }[]) {
    counts[account.label] = account.publishedListingsCount;
  }
  return counts;
}

const listing = (contaId: string, status: string) => ({
  marketplace: "shopee",
  conta_id: contaId,
  conta_apelido: "x",
  status,
  id_anuncio: status === "publicado" ? "ID-1" : null,
  url_anuncio: null,
  publicado_em: null,
  encerrado_em: null,
  erro: null,
});

describe("publishedListingsCount por conta (spec 011, seção 2.2.2)", () => {
  it("conta só anúncios `publicado`, inclusive de produtos vendidos/inativos, e ignora formato antigo", async () => {
    const accountA = await createAccount("A");
    const accountB = await createAccount("B");
    await createAccount("C-sem-anuncios");

    const { getDb } = await import("../../src/database/mongo.client.js");
    await getDb()
      .collection("products")
      .insertMany([
        { sku: "T-1", status: "disponivel", marketplaces: [listing(accountA, "publicado"), listing(accountB, "publicado")] },
        { sku: "T-2", status: "vendido", marketplaces: [listing(accountA, "publicado")] },
        { sku: "T-3", status: "inativo", marketplaces: [listing(accountA, "encerrado"), listing(accountB, "erro")] },
        // formato antigo de `marketplaces` (objeto) — nunca teve dado real (spec 011, T002)
        { sku: "T-4", status: "disponivel", marketplaces: { mercado_livre: { publicado: true, id_anuncio: "X" } } },
        { sku: "T-5", status: "rascunho" },
      ] as never[]);

    expect(await listCounts()).toEqual({ A: 2, B: 1, "C-sem-anuncios": 0 });
  });

  it("encerrar/apagar o anúncio no produto diminui a contagem", async () => {
    const { getDb } = await import("../../src/database/mongo.client.js");
    await getDb()
      .collection("products")
      .updateOne(
        { status: "vendido" },
        { $set: { "marketplaces.0.status": "encerrado", "marketplaces.0.encerrado_em": new Date() } },
      );

    expect((await listCounts()).A).toBe(1);
  });

  it("GET por id e as respostas de criação/edição também trazem a contagem, sem vazar a credencial", async () => {
    const accounts = (
      await app.inject({ method: "GET", url: "/api/marketplace-accounts", cookies: { accessToken: adminCookie } })
    ).json().data as { id: string; label: string }[];
    const accountB = accounts.find((account) => account.label === "B")!.id;

    const byId = await app.inject({
      method: "GET",
      url: `/api/marketplace-accounts/${accountB}`,
      cookies: { accessToken: adminCookie },
    });
    expect(byId.json().data.publishedListingsCount).toBe(1);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${accountB}`,
      cookies: { accessToken: adminCookie },
      payload: { label: "B" },
    });
    expect(patched.json().data.publishedListingsCount).toBe(1);
    expect(JSON.stringify(patched.json())).not.toContain("credencial-B");

    const created = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "shopee", label: "Nova", credential: "credencial-nova" },
    });
    expect(created.json().data.publishedListingsCount).toBe(0);
  });
});
