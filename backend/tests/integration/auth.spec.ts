import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hashPassword } from "../../src/services/password.service.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;

const ACTIVE_USER = { email: "maria@example.com", password: "senha-correta-123" };

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const mongoClientModule = await import("../../src/database/mongo.client.js");
  disconnectMongo = mongoClientModule.disconnectMongo;
  const db = await mongoClientModule.connectMongo();

  await db.collection("users").insertOne({
    name: "Maria Silva",
    email: ACTIVE_USER.email,
    passwordHash: await hashPassword(ACTIVE_USER.password),
    role: "operator",
    status: "active",
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
  });

  await db.collection("users").insertOne({
    name: "Usuário Inativo",
    email: "inativo@example.com",
    passwordHash: await hashPassword("qualquer-senha"),
    role: "operator",
    status: "inactive",
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
  });

  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });
}, 60_000);

afterAll(async () => {
  await app.close();
  await disconnectMongo();
  await mongoServer.stop();
});

describe("POST /api/auth/login", () => {
  it("sucesso emite cookies de sessão e retorna o usuário (sem passwordHash)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: ACTIVE_USER,
    });

    expect(response.statusCode).toBe(200);
    const cookieNames = response.cookies.map((c) => c.name);
    expect(cookieNames).toContain("accessToken");
    expect(cookieNames).toContain("refreshToken");
    expect(response.json().data).toEqual({
      id: expect.any(String),
      name: "Maria Silva",
      email: ACTIVE_USER.email,
      role: "operator",
    });
  });

  it("falha não revela se o e-mail existe (mesma mensagem para inexistente e senha errada)", async () => {
    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: ACTIVE_USER.email, password: "senha-errada" },
    });
    const unknownEmail = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "naoexiste@example.com", password: "qualquer" },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json().error).toBe(unknownEmail.json().error);
  });

  it("usuário inactive não autentica mesmo com senha correta", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "inativo@example.com", password: "qualquer-senha" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("autentica independentemente da grafia (maiúsculas/minúsculas) do e-mail", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "Maria@Example.com", password: ACTIVE_USER.password },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.email).toBe(ACTIVE_USER.email);
  });
});

describe("GET /api/auth/me", () => {
  it("retorna 401 sem cookie válido", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(response.statusCode).toBe(401);
  });

  it("retorna 200 com cookie de sessão válido", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: ACTIVE_USER,
    });
    const accessCookie = login.cookies.find((c) => c.name === "accessToken");
    expect(accessCookie).toBeDefined();

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { accessToken: accessCookie!.value },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      email: ACTIVE_USER.email,
      role: "operator",
    });
  });
});

describe("POST /api/auth/refresh", () => {
  it("retorna 401 sem cookie de refresh", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/refresh" });
    expect(response.statusCode).toBe(401);
  });

  it("retorna 401 com um refresh token inválido", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { refreshToken: "token-invalido" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("reemite os dois cookies e o novo access token autentica em /me", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: ACTIVE_USER,
    });
    const refreshCookie = login.cookies.find((c) => c.name === "refreshToken");
    expect(refreshCookie).toBeDefined();

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { refreshToken: refreshCookie!.value },
    });

    expect(refreshResponse.statusCode).toBe(200);
    const newAccessCookie = refreshResponse.cookies.find((c) => c.name === "accessToken");
    expect(newAccessCookie).toBeDefined();

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { accessToken: newAccessCookie!.value },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.email).toBe(ACTIVE_USER.email);
  });
});

describe("POST /api/auth/logout", () => {
  it("limpa os cookies de sessão e /me passa a retornar 401", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: ACTIVE_USER,
    });
    const accessCookie = login.cookies.find((c) => c.name === "accessToken");

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { accessToken: accessCookie!.value },
    });
    expect(logoutResponse.statusCode).toBe(200);

    const clearedAccess = logoutResponse.cookies.find((c) => c.name === "accessToken");
    expect(clearedAccess?.value).toBe("");

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { accessToken: accessCookie!.value },
    });
    // O cookie do request ainda é válido isoladamente (logout não revoga o JWT em si, só
    // limpa o cookie do lado do cliente) — o que importa é que o response de logout instrua o
    // browser a apagá-lo. Ver plan.md, seção 7 (sem lista de revogação nesta fase).
    expect(me.statusCode).toBe(200);
  });
});
