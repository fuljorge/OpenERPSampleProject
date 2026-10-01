import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
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

  await db.collection("categories").insertOne({
    code: "BERM",
    name: "Bermudas",
    department: "Masculino",
    active: true,
    createdAt: new Date(),
  });
  await db.collection("categories").insertOne({
    code: "JAQU",
    name: "Jaquetas",
    department: "Masculino",
    active: false,
    createdAt: new Date(),
  });

  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });
}, 60_000);

afterAll(async () => {
  await app.close();
  await disconnectMongo();
  await mongoServer.stop();
});

describe("GET /api/categories", () => {
  it("sem sessão recebe 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/categories" });
    expect(response.statusCode).toBe(401);
  });

  it("qualquer perfil autenticado pode listar (não só admin)", async () => {
    const cookie = await loginAs(OPERATOR);
    const response = await app.inject({
      method: "GET",
      url: "/api/categories",
      cookies: { accessToken: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.length).toBeGreaterThanOrEqual(2);
  });

  it("filtro active=true reflete apenas categorias ativas", async () => {
    const cookie = await loginAs(OPERATOR);
    const response = await app.inject({
      method: "GET",
      url: "/api/categories?active=true",
      cookies: { accessToken: cookie },
    });
    const codes = response.json().data.map((c: { code: string }) => c.code);
    expect(codes).toContain("BERM");
    expect(codes).not.toContain("JAQU");
  });

  it("filtro active=false reflete apenas categorias inativas (não confundir string 'false' com truthy)", async () => {
    const cookie = await loginAs(OPERATOR);
    const response = await app.inject({
      method: "GET",
      url: "/api/categories?active=false",
      cookies: { accessToken: cookie },
    });
    const codes = response.json().data.map((c: { code: string }) => c.code);
    expect(codes).toContain("JAQU");
    expect(codes).not.toContain("BERM");
  });
});

describe("POST /api/categories", () => {
  it("operator recebe 403", async () => {
    const cookie = await loginAs(OPERATOR);
    const response = await app.inject({
      method: "POST",
      url: "/api/categories",
      cookies: { accessToken: cookie },
      payload: { code: "CALC", name: "Calças", department: "Masculino" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("admin cria categoria nova", async () => {
    const cookie = await loginAs(ADMIN);
    const response = await app.inject({
      method: "POST",
      url: "/api/categories",
      cookies: { accessToken: cookie },
      payload: { code: "calc", name: "Calças", department: "Masculino" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.code).toBe("CALC");
  });

  it("code duplicado retorna erro", async () => {
    const cookie = await loginAs(ADMIN);
    const response = await app.inject({
      method: "POST",
      url: "/api/categories",
      cookies: { accessToken: cookie },
      payload: { code: "BERM", name: "Bermudas de novo", department: "Masculino" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("PATCH /api/categories/:id/status", () => {
  it("operator recebe 403", async () => {
    const cookie = await loginAs(OPERATOR);
    const db = (await import("../../src/database/mongo.client.js")).getDb();
    const target = await db.collection("categories").findOne({ code: "BERM" });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/categories/${target!._id.toHexString()}/status`,
      cookies: { accessToken: cookie },
      payload: { active: false },
    });
    expect(response.statusCode).toBe(403);
  });

  it("admin desativa — categoria continua existindo (exclusão lógica)", async () => {
    const cookie = await loginAs(ADMIN);
    const db = (await import("../../src/database/mongo.client.js")).getDb();
    const target = await db.collection("categories").findOne({ code: "BERM" });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/categories/${target!._id.toHexString()}/status`,
      cookies: { accessToken: cookie },
      payload: { active: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.active).toBe(false);

    const stillThere = await db.collection("categories").findOne({ _id: target!._id });
    expect(stillThere).not.toBeNull();
  });
});
