import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hashPassword } from "../../src/services/password.service.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };
const OPERATOR = { email: "operador@example.com", password: "senha-operador-123" };
const VIEWER = { email: "viewer@example.com", password: "senha-viewer-123" };

let adminCookie: string;
let operatorCookie: string;
let viewerCookie: string;

async function loginAs(credentials: { email: string; password: string }) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: credentials });
  const accessCookie = response.cookies.find((c) => c.name === "accessToken");
  if (!accessCookie) throw new Error(`Login falhou para ${credentials.email}: ${response.body}`);
  return accessCookie.value;
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

function mlCredential(clientId: string, clientSecret: string) {
  return JSON.stringify({ client_id: clientId, client_secret: clientSecret });
}

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    marketplace: "mercado_livre",
    label: "Loja Demo - Loja 1",
    credential: mlCredential("1620218256833906", "segredo-do-app-abcdef"),
    ...overrides,
  };
}

describe("RBAC — inclusive GET é admin-only (spec 011, seção 2.2)", () => {
  it("operator recebe 403 em GET", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: operatorCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it("viewer recebe 403 em GET", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: viewerCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it("operator recebe 403 em POST", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: operatorCookie },
      payload: createPayload(),
    });
    expect(response.statusCode).toBe(403);
  });

  it("sem sessão recebe 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/marketplace-accounts" });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/marketplace-accounts", () => {
  it("admin cria conta e a resposta nunca contém o valor completo de credential", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: adminCookie },
      payload: createPayload(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.marketplace).toBe("mercado_livre");
    // O trecho mascarado vem do client_id (identifica o aplicativo), nunca do segredo.
    expect(body.credentialPreview).toBe("****3906");
    expect(body).not.toHaveProperty("credential");
    expect(JSON.stringify(body)).not.toContain("segredo-do-app-abcdef");
  });

  it("permite cadastrar mais de uma conta do mesmo marketplace (spec 011, seção 2.3)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: adminCookie },
      payload: createPayload({ label: "Loja Demo - Loja 2" }),
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts?marketplace=mercado_livre",
      cookies: { accessToken: adminCookie },
    });
    expect(list.json().data.length).toBeGreaterThanOrEqual(2);
  });
});

describe("GET /api/marketplace-accounts", () => {
  it("admin lista contas, nenhuma com credential completo", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    for (const account of response.json().data) {
      expect(account).not.toHaveProperty("credential");
    }
  });
});

describe("PATCH /api/marketplace-accounts/:id/status", () => {
  it("desativar uma conta não afeta seu cadastro (exclusão lógica)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: adminCookie },
      payload: createPayload({ label: "Loja a desativar" }),
    });
    const id = create.json().data.id;

    const response = await app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${id}/status`,
      cookies: { accessToken: adminCookie },
      payload: { active: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.active).toBe(false);

    const get = await app.inject({
      method: "GET",
      url: `/api/marketplace-accounts/${id}`,
      cookies: { accessToken: adminCookie },
    });
    expect(get.statusCode).toBe(200);
  });

  it("operator recebe 403", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: adminCookie },
      payload: createPayload({ label: "Loja RBAC" }),
    });
    const id = create.json().data.id;

    const response = await app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${id}/status`,
      cookies: { accessToken: operatorCookie },
      payload: { active: false },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("PATCH /api/marketplace-accounts/:id", () => {
  it("trocar a credencial substitui o valor anterior por inteiro", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: adminCookie },
      payload: createPayload({ label: "Loja a editar" }),
    });
    const id = create.json().data.id;

    const response = await app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { credential: mlCredential("9999999999999999", "outro-segredo") },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.credentialPreview).toBe("****9999");
    // Client ID/Secret novos invalidam os tokens antigos: a conta volta a exigir conexão OAuth.
    expect(response.json().data.connectionStatus).toBe("disconnected");
  });
});
