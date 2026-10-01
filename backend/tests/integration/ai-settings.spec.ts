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
let viewerCookie: string;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };
const OPERATOR = { email: "operador@example.com", password: "senha-operador-123" };
const VIEWER = { email: "viewer@example.com", password: "senha-viewer-123" };

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
    { name: "Consulta", email: VIEWER.email, passwordHash: await hashPassword(VIEWER.password), role: "viewer", ...base },
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

const FULL_SETTINGS = { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", apiKey: "sk-test-abcd1234" };

describe("Configuração do provedor de IA (spec 013)", () => {
  it("só admin acessa: operator/viewer recebem 403, sem sessão 401", async () => {
    for (const [method, url] of [
      ["GET", "/api/settings/ai"],
      ["PATCH", "/api/settings/ai"],
    ] as const) {
      const asOperator = await app.inject({ method, url, cookies: { accessToken: operatorCookie }, payload: FULL_SETTINGS });
      expect(asOperator.statusCode).toBe(403);
      const asViewer = await app.inject({ method, url, cookies: { accessToken: viewerCookie }, payload: FULL_SETTINGS });
      expect(asViewer.statusCode).toBe(403);
      const anonymous = await app.inject({ method, url, payload: FULL_SETTINGS });
      expect(anonymous.statusCode).toBe(401);
    }
  });

  it("sem configuração ainda: GET devolve data null, não 404", async () => {
    const response = await app.inject({ method: "GET", url: "/api/settings/ai", cookies: { accessToken: adminCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toBeNull();
  });

  it("primeira configuração sem apiKey ou sem model: 400, nada é gravado", async () => {
    const semApiKey = await app.inject({
      method: "PATCH",
      url: "/api/settings/ai",
      cookies: { accessToken: adminCookie },
      payload: { baseUrl: "https://x.test", model: "gpt-4o-mini" },
    });
    expect(semApiKey.statusCode).toBe(400);

    const semModel = await app.inject({
      method: "PATCH",
      url: "/api/settings/ai",
      cookies: { accessToken: adminCookie },
      payload: { apiKey: "sk-abcd" },
    });
    expect(semModel.statusCode).toBe(400);

    const get = await app.inject({ method: "GET", url: "/api/settings/ai", cookies: { accessToken: adminCookie } });
    expect(get.json().data).toBeNull();
  });

  it("achado real: primeira configuração sem baseUrl (deixado em branco = OpenAI oficial) não quebra a resposta seguinte", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/settings/ai",
      cookies: { accessToken: adminCookie },
      payload: { model: "gpt-4o-mini", apiKey: "sk-sem-base-url" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.baseUrl).toBe("");

    const get = await app.inject({ method: "GET", url: "/api/settings/ai", cookies: { accessToken: adminCookie } });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.baseUrl).toBe("");
  });

  it("PATCH completo grava, GET devolve os valores — nunca apiKey (cifrada ou não) em nenhuma resposta", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/settings/ai",
      cookies: { accessToken: adminCookie },
      payload: FULL_SETTINGS,
    });
    expect(patch.statusCode).toBe(200);
    const patchBody = patch.json();
    expect(patchBody.data).toMatchObject({ baseUrl: FULL_SETTINGS.baseUrl, model: FULL_SETTINGS.model, apiKeyPreview: "****1234" });
    expect(JSON.stringify(patchBody)).not.toContain(FULL_SETTINGS.apiKey);
    expect(patchBody.data).not.toHaveProperty("apiKey");

    const get = await app.inject({ method: "GET", url: "/api/settings/ai", cookies: { accessToken: adminCookie } });
    const getBody = get.json();
    expect(getBody.data).toMatchObject({ baseUrl: FULL_SETTINGS.baseUrl, model: FULL_SETTINGS.model, apiKeyPreview: "****1234" });
    expect(JSON.stringify(getBody)).not.toContain(FULL_SETTINGS.apiKey);
  });

  it("PATCH só com model, sem apiKey: mantém o preview da chave anterior (não apaga)", async () => {
    await app.inject({ method: "PATCH", url: "/api/settings/ai", cookies: { accessToken: adminCookie }, payload: FULL_SETTINGS });

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/settings/ai",
      cookies: { accessToken: adminCookie },
      payload: { model: "gpt-4o" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data).toMatchObject({ model: "gpt-4o", apiKeyPreview: "****1234" });
  });

  it("PATCH substitui o único documento, nunca cria um segundo", async () => {
    await app.inject({ method: "PATCH", url: "/api/settings/ai", cookies: { accessToken: adminCookie }, payload: FULL_SETTINGS });
    await app.inject({
      method: "PATCH",
      url: "/api/settings/ai",
      cookies: { accessToken: adminCookie },
      payload: { model: "gpt-4o", apiKey: "sk-outra-chave-9999" },
    });

    const { getDb } = await import("../../src/database/mongo.client.js");
    const count = await getDb().collection("ai_settings").countDocuments();
    expect(count).toBe(1);
  });

  it("grava em audit_logs (spec 008) sem a chave nos metadados", async () => {
    await app.inject({ method: "PATCH", url: "/api/settings/ai", cookies: { accessToken: adminCookie }, payload: FULL_SETTINGS });

    const { getDb } = await import("../../src/database/mongo.client.js");
    const log = await getDb()
      .collection("audit_logs")
      .findOne({ action: "AI_SETTINGS_UPDATE" }, { sort: { timestamp: -1 } });
    expect(log).toMatchObject({ entity: "ai_settings", entityId: "default" });
    expect(JSON.stringify(log?.metadata)).not.toContain(FULL_SETTINGS.apiKey);
  });
});
