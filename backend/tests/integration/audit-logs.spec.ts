import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import { hashPassword } from "../../src/services/password.service.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;
let recordFn: typeof import("../../src/services/audit-log.service.js").record;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };
const OPERATOR = { email: "operador@example.com", password: "senha-operador-123" };
const adminId = new ObjectId();
const operatorId = new ObjectId();

async function loginAs(credentials: { email: string; password: string }) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: credentials,
  });
  const accessCookie = response.cookies.find((c) => c.name === "accessToken");
  if (!accessCookie) throw new Error(`Login falhou para ${credentials.email}: ${response.body}`);
  return accessCookie.value;
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const mongoClientModule = await import("../../src/database/mongo.client.js");
  disconnectMongo = mongoClientModule.disconnectMongo;
  const db = await mongoClientModule.connectMongo();

  await db.collection("users").insertMany([
    {
      _id: adminId,
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
      _id: operatorId,
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
  ]);

  recordFn = (await import("../../src/services/audit-log.service.js")).record;

  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });
}, 60_000);

afterAll(async () => {
  await app.close();
  await disconnectMongo();
  await mongoServer.stop();
});

describe("Registro de eventos (spec 008, critérios de aceite)", () => {
  it("login falho com e-mail existente gera LOGIN_FAILED com o userId correspondente", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: ADMIN.email, password: "senha-errada" },
    });

    const cookie = await loginAs(ADMIN);
    const response = await app.inject({
      method: "GET",
      url: `/api/audit-logs?action=LOGIN_FAILED&userId=${adminId.toHexString()}`,
      cookies: { accessToken: cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(body.data.items[0]).toMatchObject({
      action: "LOGIN_FAILED",
      entity: "user",
      userId: adminId.toHexString(),
    });
  });

  it("login falho com e-mail inexistente gera LOGIN_FAILED sem userId (não revela existência do e-mail)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "naoexiste@example.com", password: "qualquer" },
    });

    const cookie = await loginAs(ADMIN);
    const response = await app.inject({
      method: "GET",
      url: "/api/audit-logs?action=LOGIN_FAILED",
      cookies: { accessToken: cookie },
    });

    const body = response.json();
    const withoutUserId = body.data.items.find((item: { userId?: string }) => item.userId === undefined);
    expect(withoutUserId).toBeDefined();
  });

  it("PRICE_UPDATE registra oldValue/newValue em metadata (via audit-log.service.record, produto ainda não implementado)", async () => {
    await recordFn("PRICE_UPDATE", "product", "produto-fixture-1", adminId.toHexString(), {
      field: "preco.preco_venda",
      oldValue: 129.9,
      newValue: 119.9,
    });

    const cookie = await loginAs(ADMIN);
    const response = await app.inject({
      method: "GET",
      url: "/api/audit-logs?action=PRICE_UPDATE",
      cookies: { accessToken: cookie },
    });

    const body = response.json();
    expect(body.data.items[0]).toMatchObject({
      action: "PRICE_UPDATE",
      entity: "product",
      entityId: "produto-fixture-1",
      metadata: { field: "preco.preco_venda", oldValue: 129.9, newValue: 119.9 },
    });
  });
});

describe("GET /api/audit-logs", () => {
  it("operator recebe 403", async () => {
    const cookie = await loginAs(OPERATOR);
    const response = await app.inject({
      method: "GET",
      url: "/api/audit-logs",
      cookies: { accessToken: cookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it("sem sessão recebe 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/audit-logs" });
    expect(response.statusCode).toBe(401);
  });

  it("admin lista com paginação (limit) e os registros nunca expõem campo fora do contrato", async () => {
    const cookie = await loginAs(ADMIN);
    const response = await app.inject({
      method: "GET",
      url: "/api/audit-logs?limit=2&page=1",
      cookies: { accessToken: cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.items.length).toBeLessThanOrEqual(2);
    expect(body.data).toMatchObject({ page: 1, limit: 2 });
    expect(body.data.total).toBeGreaterThan(0);

    const allowedKeys = ["id", "userId", "action", "entity", "entityId", "timestamp", "metadata"];
    for (const item of body.data.items) {
      for (const key of Object.keys(item)) {
        expect(allowedKeys).toContain(key);
      }
    }
  });
});
