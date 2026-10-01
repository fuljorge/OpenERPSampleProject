import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hashPassword } from "../../src/services/password.service.js";
import { setMercadoLivreOAuthClientForTesting } from "../../src/services/mercado-livre-oauth.service.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;
let adminCookie: string;
let operatorCookie: string;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };
const OPERATOR = { email: "operador@example.com", password: "senha-operador-123" };
const CLIENT_ID = "1620218256833906";
const CLIENT_SECRET = "segredo-do-aplicativo";

async function loginAs(credentials: { email: string; password: string }) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: credentials });
  return response.cookies.find((c) => c.name === "accessToken")!.value;
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.MARKETPLACE_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
  process.env.FRONTEND_URL = "https://sistema.teste.com.br";

  setMercadoLivreOAuthClientForTesting({
    async exchangeCode() {
      return { accessToken: "APP_USR-access", refreshToken: "TG-refresh", expiresIn: 21600, userId: 987654 };
    },
    async requestApplicationToken() {
      return "APP_USR-app";
    },
    async fetchCurrentUser() {
      return { id: 987654, nickname: "OPENERPSAMPLE" };
    },
  });

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

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: { accessToken: adminCookie }, ...(payload ? { payload } : {}) });

async function createConnectedAccount(label = "Loja ML") {
  const created = await call("POST", "/api/marketplace-accounts", {
    marketplace: "mercado_livre",
    label,
    credential: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const id = created.json().data.id as string;
  const authorize = await call("POST", `/api/marketplace-accounts/${id}/oauth/authorize`);
  const state = new URL(authorize.json().data.authorizationUrl).searchParams.get("state")!;
  const complete = await call("POST", "/api/marketplace-accounts/oauth/mercado-livre/complete", {
    code: "TG-codigo",
    state,
  });
  expect(complete.json().data.connectionStatus).toBe("connected");
  return id;
}

async function rawCredential(id: string) {
  const { getActiveMarketplaceAccountForConnector } = await import("../../src/services/marketplace-account.service.js");
  return (await getActiveMarketplaceAccountForConnector(id)).credential;
}

async function storedCredential(id: string) {
  return JSON.parse(await rawCredential(id)) as Record<string, unknown>;
}

const setActive = (id: string, active: boolean) => call("PATCH", `/api/marketplace-accounts/${id}/status`, { active });

describe("ciclo de vida da conta: Desconectar → Desativar → Apagar (spec 011, seção 2.2.2; ADR-022)", () => {
  it("só admin: operator recebe 403 e sem sessão 401 em Desconectar e Apagar", async () => {
    for (const [method, url] of [
      ["POST", "/api/marketplace-accounts/abc/disconnect"],
      ["DELETE", "/api/marketplace-accounts/abc"],
    ] as const) {
      expect((await app.inject({ method, url, cookies: { accessToken: operatorCookie } })).statusCode).toBe(403);
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it("fluxo completo com conta conectada: a ordem é imposta pelo backend em cada passo", async () => {
    const id = await createConnectedAccount();
    expect(await storedCredential(id)).toMatchObject({ access_token: "APP_USR-access", refresh_token: "TG-refresh" });

    // 1) Conectada: nem desativa nem apaga.
    const deactivateConnected = await setActive(id, false);
    expect(deactivateConnected.statusCode).toBe(409);
    expect(deactivateConnected.json().error).toMatch(/Desconecte a conta antes de desativá-la/);
    const deleteConnected = await call("DELETE", `/api/marketplace-accounts/${id}`);
    expect(deleteConnected.statusCode).toBe(409);
    expect(deleteConnected.json().error).toMatch(/Desconecte/);

    // 2) Desconectar: status muda e os tokens somem; Client ID/Secret ficam (dá para reconectar).
    const disconnected = await call("POST", `/api/marketplace-accounts/${id}/disconnect`);
    expect(disconnected.statusCode).toBe(200);
    expect(disconnected.json().data).toMatchObject({ id, connectionStatus: "disconnected", active: true });
    expect(await storedCredential(id)).toEqual({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET });

    // 3) Desconectada mas ainda ativa: não apaga.
    const deleteActive = await call("DELETE", `/api/marketplace-accounts/${id}`);
    expect(deleteActive.statusCode).toBe(409);
    expect(deleteActive.json().error).toMatch(/Desative a conta/);

    // 4) Desativar e, só então, Apagar.
    expect((await setActive(id, false)).statusCode).toBe(200);
    const removed = await call("DELETE", `/api/marketplace-accounts/${id}`);
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data).toEqual({ id });

    expect((await call("GET", `/api/marketplace-accounts/${id}`)).statusCode).toBe(404);
    const list = await call("GET", "/api/marketplace-accounts");
    expect((list.json().data as { id: string }[]).some((account) => account.id === id)).toBe(false);
    expect((await call("DELETE", `/api/marketplace-accounts/${id}`)).statusCode).toBe(404);
  });

  it("conta desativada e reativada volta desconectada e pode seguir o ciclo de novo", async () => {
    const id = await createConnectedAccount("Loja reativada");
    await call("POST", `/api/marketplace-accounts/${id}/disconnect`);
    await setActive(id, false);

    const reactivated = await setActive(id, true);
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().data).toMatchObject({ active: true, connectionStatus: "disconnected" });
    expect((await call("DELETE", `/api/marketplace-accounts/${id}`)).statusCode).toBe(409);
  });

  it("desconectar cancela uma autorização OAuth em andamento (o retorno atrasado não reconecta)", async () => {
    const created = await call("POST", "/api/marketplace-accounts", {
      marketplace: "mercado_livre",
      label: "Loja com OAuth pendente",
      credential: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    });
    const id = created.json().data.id as string;
    const authorize = await call("POST", `/api/marketplace-accounts/${id}/oauth/authorize`);
    const state = new URL(authorize.json().data.authorizationUrl).searchParams.get("state")!;

    await call("POST", `/api/marketplace-accounts/${id}/disconnect`);

    const late = await call("POST", "/api/marketplace-accounts/oauth/mercado-livre/complete", { code: "TG-tarde", state });
    expect(late.statusCode).toBe(400);
    expect((await call("GET", `/api/marketplace-accounts/${id}`)).json().data.connectionStatus).toBe("disconnected");
  });

  it("outro marketplace: desconectar/desativar/apagar valem igual, sem mexer na credencial", async () => {
    const created = await call("POST", "/api/marketplace-accounts", {
      marketplace: "shopee",
      label: "Loja Shopee",
      credential: "api-key-shopee",
    });
    const id = created.json().data.id as string;

    expect((await call("POST", `/api/marketplace-accounts/${id}/disconnect`)).statusCode).toBe(200);
    expect(await rawCredential(id)).toBe("api-key-shopee");
    expect((await setActive(id, false)).statusCode).toBe(200);
    expect((await call("DELETE", `/api/marketplace-accounts/${id}`)).statusCode).toBe(200);
  });

  it("id inexistente: 404 em Desconectar e em Apagar", async () => {
    const ghost = "64b000000000000000000000";
    expect((await call("POST", `/api/marketplace-accounts/${ghost}/disconnect`)).statusCode).toBe(404);
    expect((await call("DELETE", `/api/marketplace-accounts/${ghost}`)).statusCode).toBe(404);
  });

  it("auditoria: desconexão e exclusão registradas com o admin, sem credencial nem tokens", async () => {
    const [disconnect, remove] = await Promise.all(
      ["MARKETPLACE_ACCOUNT_DISCONNECT", "MARKETPLACE_ACCOUNT_DELETE"].map((action) =>
        call("GET", `/api/audit-logs?action=${action}`),
      ),
    );

    const disconnectItems = disconnect!.json().data.items as { userId: string }[];
    const deleteItems = remove!.json().data.items as { userId: string; metadata?: Record<string, unknown> }[];
    expect(disconnectItems.length).toBeGreaterThanOrEqual(1);
    expect(deleteItems.length).toBeGreaterThanOrEqual(1);
    expect(deleteItems[0]!.userId).toBeTruthy();
    expect(deleteItems[0]!.metadata).toMatchObject({ marketplace: expect.any(String), label: expect.any(String) });

    const everything = JSON.stringify([disconnectItems, deleteItems]);
    for (const secret of [CLIENT_SECRET, "APP_USR-access", "TG-refresh", "api-key-shopee"]) {
      expect(everything).not.toContain(secret);
    }
  });
});
