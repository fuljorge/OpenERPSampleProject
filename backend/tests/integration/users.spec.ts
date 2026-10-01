import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import { hashPassword } from "../../src/services/password.service.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };
const OPERATOR = { email: "operador@example.com", password: "senha-operador-123" };

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
  ]);

  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });
}, 60_000);

afterAll(async () => {
  await app.close();
  await disconnectMongo();
  await mongoServer.stop();
});

describe("Acesso restrito a admin", () => {
  it("operator recebe 403 em qualquer rota de /api/users", async () => {
    const cookie = await loginAs(OPERATOR);

    const routes = [
      { method: "GET" as const, url: "/api/users" },
      { method: "POST" as const, url: "/api/users", payload: {} },
      { method: "PATCH" as const, url: "/api/users/000000000000000000000000", payload: {} },
    ];

    for (const route of routes) {
      const response = await app.inject({
        method: route.method,
        url: route.url,
        payload: route.payload,
        cookies: { accessToken: cookie },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it("requisição sem sessão recebe 401 antes mesmo do 403", async () => {
    const response = await app.inject({ method: "GET", url: "/api/users" });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/users", () => {
  it("admin cria usuário com hash Argon2id, status active e createdBy preenchido", async () => {
    const cookie = await loginAs(ADMIN);

    const response = await app.inject({
      method: "POST",
      url: "/api/users",
      cookies: { accessToken: cookie },
      payload: {
        name: "Nova Operadora",
        email: "nova@example.com",
        password: "senha-nova-123",
        role: "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data).toMatchObject({
      name: "Nova Operadora",
      email: "nova@example.com",
      role: "operator",
      status: "active",
    });
    expect(body.data.createdBy).toEqual(expect.any(String));
    expect(body.data.passwordHash).toBeUndefined();

    const db = (await import("../../src/database/mongo.client.js")).getDb();
    const doc = await db.collection("users").findOne({ email: "nova@example.com" });
    expect(doc?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it("rejeita e-mail duplicado com 400", async () => {
    const cookie = await loginAs(ADMIN);

    const response = await app.inject({
      method: "POST",
      url: "/api/users",
      cookies: { accessToken: cookie },
      payload: {
        name: "Duplicado",
        email: ADMIN.email,
        password: "senha-qualquer-1",
        role: "viewer",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("PATCH /api/users/:id/status", () => {
  it("nunca remove fisicamente o documento — só muda status — e o usuário desativado não loga mais", async () => {
    const cookie = await loginAs(ADMIN);
    const db = (await import("../../src/database/mongo.client.js")).getDb();
    const target = await db.collection("users").findOne({ email: OPERATOR.email });
    const id = (target!._id as ObjectId).toHexString();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/users/${id}/status`,
      cookies: { accessToken: cookie },
      payload: { status: "inactive" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("inactive");

    const stillThere = await db.collection("users").findOne({ _id: target!._id });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe("inactive");

    const loginAttempt = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: OPERATOR,
    });
    expect(loginAttempt.statusCode).toBe(401);
  });
});
