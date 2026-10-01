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

const VALID_SETTINGS = { altura_cm: 10, largura_cm: 30, comprimento_cm: 40, peso_g: 300 };

describe("Pacote padrão do Mercado Livre (spec 012, seção 3.4; ADR-027)", () => {
  it("só admin acessa: operator recebe 403, sem sessão 401", async () => {
    for (const [method, url] of [
      ["GET", "/api/marketplace-accounts/mercado-livre-package-settings"],
      ["PUT", "/api/marketplace-accounts/mercado-livre-package-settings"],
    ] as const) {
      const asOperator = await app.inject({ method, url, cookies: { accessToken: operatorCookie }, payload: VALID_SETTINGS });
      expect(asOperator.statusCode).toBe(403);
      const anonymous = await app.inject({ method, url, payload: VALID_SETTINGS });
      expect(anonymous.statusCode).toBe(401);
    }
  });

  it("sem configuração ainda: GET devolve data null, não 404", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts/mercado-livre-package-settings",
      cookies: { accessToken: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toBeNull();
  });

  it("PUT grava e GET devolve os valores gravados, com metadados de auditoria", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/marketplace-accounts/mercado-livre-package-settings",
      cookies: { accessToken: adminCookie },
      payload: VALID_SETTINGS,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toMatchObject({ ...VALID_SETTINGS, updatedBy: expect.any(String) });

    const get = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts/mercado-livre-package-settings",
      cookies: { accessToken: adminCookie },
    });
    expect(get.json().data).toMatchObject(VALID_SETTINGS);
  });

  it("PUT de novo substitui o único documento, nunca cria um segundo", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/marketplace-accounts/mercado-livre-package-settings",
      cookies: { accessToken: adminCookie },
      payload: VALID_SETTINGS,
    });
    await app.inject({
      method: "PUT",
      url: "/api/marketplace-accounts/mercado-livre-package-settings",
      cookies: { accessToken: adminCookie },
      payload: { altura_cm: 15, largura_cm: 35, comprimento_cm: 45, peso_g: 500 },
    });

    const { getDb } = await import("../../src/database/mongo.client.js");
    const count = await getDb().collection("mercado_livre_package_settings").countDocuments();
    expect(count).toBe(1);

    const get = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts/mercado-livre-package-settings",
      cookies: { accessToken: adminCookie },
    });
    expect(get.json().data).toMatchObject({ altura_cm: 15, largura_cm: 35, comprimento_cm: 45, peso_g: 500 });
  });

  it("rejeita valores decimais, zero ou negativos, com 400", async () => {
    for (const invalid of [
      { ...VALID_SETTINGS, altura_cm: 10.5 },
      { ...VALID_SETTINGS, largura_cm: 0 },
      { ...VALID_SETTINGS, peso_g: -1 },
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: "/api/marketplace-accounts/mercado-livre-package-settings",
        cookies: { accessToken: adminCookie },
        payload: invalid,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("grava em audit_logs (spec 008)", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/marketplace-accounts/mercado-livre-package-settings",
      cookies: { accessToken: adminCookie },
      payload: VALID_SETTINGS,
    });

    const { getDb } = await import("../../src/database/mongo.client.js");
    const log = await getDb()
      .collection("audit_logs")
      .findOne({ action: "MERCADO_LIVRE_PACKAGE_SETTINGS_UPDATE" }, { sort: { timestamp: -1 } });
    expect(log).toMatchObject({ entity: "mercado_livre_package_settings", entityId: "default" });
  });
});
