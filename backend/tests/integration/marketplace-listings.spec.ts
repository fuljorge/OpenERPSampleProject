import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hashPassword } from "../../src/services/password.service.js";
import { setMarketplaceConnectorForTesting } from "../../src/services/marketplace-listing.service.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let db: Db;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };
const OPERATOR = { email: "operador@example.com", password: "senha-operador-123" };
const VIEWER = { email: "viewer@example.com", password: "senha-viewer-123" };

let adminCookie: string;
let operatorCookie: string;
let viewerCookie: string;
let fakePublishCounter = 0;

async function loginAs(credentials: { email: string; password: string }) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: credentials });
  const accessCookie = response.cookies.find((c) => c.name === "accessToken");
  if (!accessCookie) throw new Error(`Login falhou para ${credentials.email}: ${response.body}`);
  return accessCookie.value;
}

function minimalProductPayload(overrides: Record<string, unknown> = {}) {
  return {
    identificacao: { nome: "Bermuda Jeans Stretch Masculina Azul Tamanho 32" },
    classificacao: { categoria_codigo: "BERM" },
    condicao: { estado: "novo" },
    preco: { preco_venda: 129.9 },
    imagens: { principal: { id: "img1", url: "https://example.com/1.jpg" }, galeria: [{ id: "img1", url: "https://example.com/1.jpg" }] },
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.MARKETPLACE_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");

  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const mongoClientModule = await import("../../src/database/mongo.client.js");
  disconnectMongo = mongoClientModule.disconnectMongo;
  db = await mongoClientModule.connectMongo();

  await db.collection("users").insertMany([
    {
      name: "Administradora",
      email: ADMIN.email,
      passwordHash: await hashPassword(ADMIN.password),
      role: "admin",
      status: "active",
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    },
    {
      name: "Operador",
      email: OPERATOR.email,
      passwordHash: await hashPassword(OPERATOR.password),
      role: "operator",
      status: "active",
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    },
    {
      name: "Consulta",
      email: VIEWER.email,
      passwordHash: await hashPassword(VIEWER.password),
      role: "viewer",
      status: "active",
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    },
  ]);

  await db.collection("categories").insertOne({
    code: "BERM",
    name: "Bermudas",
    department: "Masculino",
    active: true,
    createdAt: new Date(),
  });

  // Dublê do conector (spec 011, seção 1: nenhum adapter real nesta spec) — simula sucesso,
  // exceto para uma credencial-sentinela usada no teste de falha.
  setMarketplaceConnectorForTesting({
    async publish({ credential }) {
      if (credential.includes("credencial-invalida")) {
        throw new Error("Credencial expirada");
      }
      fakePublishCounter += 1;
      return {
        value: {
          id_anuncio: `MLB-${fakePublishCounter}`,
          url_anuncio: `https://example.com/MLB-${fakePublishCounter}`,
          pendencia: null,
        },
      };
    },
    async close() {
      return { value: { encerrado: true as const } };
    },
  });

  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });

  adminCookie = await loginAs(ADMIN);
  operatorCookie = await loginAs(OPERATOR);
  viewerCookie = await loginAs(VIEWER);
}, 60_000);

afterAll(async () => {
  await app.close();
  await disconnectMongo();
  await mongoServer.stop();
});

async function createAccount(cookie: string, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts",
    cookies: { accessToken: cookie },
    payload: {
      marketplace: "mercado_livre",
      label: "Loja Demo - Loja 1",
      credential: JSON.stringify({ client_id: "1620218256833906", client_secret: "credencial-valida" }),
      ...overrides,
    },
  });
  return response.json().data.id as string;
}

async function createProduct(cookie: string, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/products",
    cookies: { accessToken: cookie },
    payload: minimalProductPayload(overrides),
  });
  return response.json().data.id as string;
}

describe("POST /api/products/:id/marketplace-listings", () => {
  it("viewer recebe 403", async () => {
    const productId = await createProduct(adminCookie);
    const accountId = await createAccount(adminCookie);

    const response = await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: viewerCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });
    expect(response.statusCode).toBe(403);
  });

  it("operator publica com sucesso (mesma permissão de 'publicar produtos')", async () => {
    const productId = await createProduct(operatorCookie);
    const accountId = await createAccount(adminCookie);

    const response = await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: operatorCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });

    expect(response.statusCode).toBe(200);
    const listing = response.json().data.marketplaces[0];
    expect(listing).toMatchObject({ marketplace: "mercado_livre", status: "publicado", conta_id: accountId });
    expect(listing.id_anuncio).toMatch(/^MLB-/);
  });

  it("publica normalmente um produto no formato pré-011 (marketplaces como objeto fixo, não array)", async () => {
    // Documento anterior à spec 011 (005/007): `marketplaces` era um objeto fixo por nome, não a
    // lista atual. `productRepository` revalida via ProductSchema.parse ao ler (o preprocess de
    // MarketplacesSchema vira `[]`) — sem isso, `publishListing` quebra com "product.marketplaces
    // .find is not a function" antes mesmo de chegar na rota, achado real em produção (22/09/2026).
    const productId = await createProduct(adminCookie);
    await db
      .collection("products")
      .updateOne({ _id: new ObjectId(productId) }, { $set: { marketplaces: { mercado_livre: { publicado: false } } } });
    const accountId = await createAccount(adminCookie);

    const response = await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });

    expect(response.statusCode).toBe(200);
    const listing = response.json().data.marketplaces[0];
    expect(listing).toMatchObject({ marketplace: "mercado_livre", status: "publicado", conta_id: accountId });
  });

  it("publicar a mesma peça numa segunda conta do mesmo marketplace cria uma segunda entrada independente", async () => {
    const productId = await createProduct(adminCookie);
    const account1 = await createAccount(adminCookie, { label: "Loja 1" });
    const account2 = await createAccount(adminCookie, { label: "Loja 2" });

    await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId: account1 },
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId: account2 },
    });

    expect(second.statusCode).toBe(200);
    const listings = second.json().data.marketplaces;
    expect(listings).toHaveLength(2);
    const contaIds = listings.map((l: { conta_id: string }) => l.conta_id);
    expect(contaIds).toContain(account1);
    expect(contaIds).toContain(account2);
  });

  it("republicar na mesma combinação (marketplace, conta) atualiza o item em vez de duplicar", async () => {
    const productId = await createProduct(adminCookie);
    const accountId = await createAccount(adminCookie);

    await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });
    const again = await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });

    expect(again.json().data.marketplaces).toHaveLength(1);
  });

  it("bloqueia publicação sem preço de venda, com mensagem clara, sem chamar o conector", async () => {
    const productId = await createProduct(adminCookie, { preco: undefined });
    const accountId = await createAccount(adminCookie);

    const response = await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("preço de venda");
  });

  it("falha do conector grava status=erro sem quebrar a resposta", async () => {
    const productId = await createProduct(adminCookie);
    const accountId = await createAccount(adminCookie, {
      credential: JSON.stringify({ client_id: "1620218256833906", client_secret: "credencial-invalida" }),
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });

    expect(response.statusCode).toBe(200);
    const listing = response.json().data.marketplaces[0];
    expect(listing.status).toBe("erro");
    expect(listing.erro).toBe("Credencial expirada");
  });

  it("desativar uma conta não altera nem remove publicações já existentes feitas através dela", async () => {
    const productId = await createProduct(adminCookie);
    const accountId = await createAccount(adminCookie);

    await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });

    await app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${accountId}/status`,
      cookies: { accessToken: adminCookie },
      payload: { active: false },
    });

    const get = await app.inject({
      method: "GET",
      url: `/api/products/${productId}`,
      cookies: { accessToken: adminCookie },
    });
    expect(get.json().data.marketplaces[0].status).toBe("publicado");
  });

  it("apagar a conta (ADR-022) não altera o anúncio: conta_id e conta_apelido continuam no produto", async () => {
    const productId = await createProduct(adminCookie);
    const accountId = await createAccount(adminCookie, { label: "Loja que será apagada" });

    await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${accountId}/status`,
      cookies: { accessToken: adminCookie },
      payload: { active: false },
    });
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/marketplace-accounts/${accountId}`,
      cookies: { accessToken: adminCookie },
    });
    expect(removed.statusCode).toBe(200);

    const get = await app.inject({
      method: "GET",
      url: `/api/products/${productId}`,
      cookies: { accessToken: adminCookie },
    });
    expect(get.json().data.marketplaces[0]).toMatchObject({
      status: "publicado",
      conta_id: accountId,
      conta_apelido: "Loja que será apagada",
    });

    // Sem a conta, não dá para republicar por ela.
    const retry = await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });
    expect(retry.statusCode).toBe(404);
  });

  it("publicar através de uma conta desativada é rejeitado", async () => {
    const productId = await createProduct(adminCookie);
    const accountId = await createAccount(adminCookie, { label: "Loja a desativar antes de publicar" });

    await app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${accountId}/status`,
      cookies: { accessToken: adminCookie },
      payload: { active: false },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/products/${productId}/marketplace-listings`,
      cookies: { accessToken: adminCookie },
      payload: { marketplace: "mercado_livre", accountId },
    });
    expect(response.statusCode).toBe(404);
  });
});
