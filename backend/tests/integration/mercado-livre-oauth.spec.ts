import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hashPassword } from "../../src/services/password.service.js";
import {
  MercadoLivreOAuthError,
  type ExchangeCodeInput,
} from "../../src/plugins/marketplaces/mercado-livre-oauth.client.js";
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
const REDIRECT_URI = "https://sistema.teste.com.br/admin/marketplace-accounts/oauth/callback";

const exchangeCalls: ExchangeCodeInput[] = [];
const testCalls: { clientId: string; clientSecret: string; bearer?: string }[] = [];
let fakeError: MercadoLivreOAuthError | null = null;
let fakeUserError: MercadoLivreOAuthError | null = null;

async function loginAs(credentials: { email: string; password: string }) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: credentials });
  return response.cookies.find((c) => c.name === "accessToken")!.value;
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.MARKETPLACE_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
  process.env.FRONTEND_URL = "https://sistema.teste.com.br/";

  setMercadoLivreOAuthClientForTesting({
    async exchangeCode(input) {
      exchangeCalls.push(input);
      if (fakeError) throw fakeError;
      return { accessToken: "APP_USR-access-novo", refreshToken: "TG-refresh-novo", expiresIn: 21600, userId: 987654 };
    },
    async requestApplicationToken(input) {
      testCalls.push({ clientId: input.clientId, clientSecret: input.clientSecret });
      if (fakeError) throw fakeError;
      return "APP_USR-token-do-aplicativo";
    },
    async fetchCurrentUser(accessToken) {
      const last = testCalls[testCalls.length - 1];
      if (last) last.bearer = accessToken;
      if (fakeUserError) throw fakeUserError;
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

const mlCredential = (clientId = CLIENT_ID, clientSecret = CLIENT_SECRET) =>
  JSON.stringify({ client_id: clientId, client_secret: clientSecret });

async function createAccount(payload: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/marketplace-accounts",
    cookies: { accessToken: adminCookie },
    payload: { marketplace: "mercado_livre", label: "Loja ML", credential: mlCredential(), ...payload },
  });
}

async function authorize(id: string) {
  return app.inject({
    method: "POST",
    url: `/api/marketplace-accounts/${id}/oauth/authorize`,
    cookies: { accessToken: adminCookie },
  });
}

async function complete(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/marketplace-accounts/oauth/mercado-livre/complete",
    cookies: { accessToken: adminCookie },
    payload,
  });
}

/** Conta criada + autorização iniciada; devolve id e o state que o Mercado Livre devolveria. */
async function startedAccount() {
  const id = (await createAccount()).json().data.id as string;
  const url = new URL((await authorize(id)).json().data.authorizationUrl);
  return { id, state: url.searchParams.get("state")! };
}

async function storedAccount(id: string) {
  const { getDb } = await import("../../src/database/mongo.client.js");
  const { ObjectId } = await import("mongodb");
  return getDb().collection("marketplace_accounts").findOne({ _id: new ObjectId(id) });
}

describe("cadastro do Mercado Livre por OAuth (spec 012, seção 2.2)", () => {
  it("só admin: operator recebe 403 e sem sessão 401 em todas as rotas de OAuth", async () => {
    for (const [method, url] of [
      ["GET", "/api/marketplace-accounts/oauth/redirect-uri"],
      ["POST", "/api/marketplace-accounts/abc/oauth/authorize"],
      ["POST", "/api/marketplace-accounts/oauth/mercado-livre/complete"],
    ] as const) {
      expect((await app.inject({ method, url, cookies: { accessToken: operatorCookie } })).statusCode).toBe(403);
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it("teste de integração: token do aplicativo + GET /users/me com o Bearer, sem gravar nada", async () => {
    testCalls.length = 0;
    const accountsBefore = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: adminCookie },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts/mercado-livre/test-connection",
      cookies: { accessToken: adminCookie },
      payload: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ userId: 987654, nickname: "OPENERPSAMPLE" });
    expect(testCalls).toEqual([
      { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, bearer: "APP_USR-token-do-aplicativo" },
    ]);
    expect(JSON.stringify(response.json())).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(response.json())).not.toContain("APP_USR-token-do-aplicativo");

    const accountsAfter = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts",
      cookies: { accessToken: adminCookie },
    });
    expect(accountsAfter.json().data).toHaveLength(accountsBefore.json().data.length);
  });

  it("teste de integração: credenciais recusadas ou /users/me com erro viram 400 sem vazar segredo", async () => {
    const call = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/api/marketplace-accounts/mercado-livre/test-connection",
        cookies: { accessToken: adminCookie },
        payload,
      });

    fakeError = new MercadoLivreOAuthError("Client ID ou Client Secret inválido.");
    try {
      const refused = await call({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error).toBe("Client ID ou Client Secret inválido.");
    } finally {
      fakeError = null;
    }

    fakeUserError = new MercadoLivreOAuthError("GET /users/me falhou no Mercado Livre (HTTP 500).");
    try {
      const failed = await call({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
      expect(failed.statusCode).toBe(400);
      expect(JSON.stringify(failed.json())).not.toContain(CLIENT_SECRET);
    } finally {
      fakeUserError = null;
    }

    expect((await call({ client_id: CLIENT_ID })).statusCode).toBe(400);
    expect((await call({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, extra: 1 })).statusCode).toBe(400);
  });

  it("teste de integração: só admin", async () => {
    const url = "/api/marketplace-accounts/mercado-livre/test-connection";
    expect((await app.inject({ method: "POST", url, cookies: { accessToken: operatorCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(401);
  });

  it("expõe o redirect URI a cadastrar no aplicativo do Mercado Livre (derivado de FRONTEND_URL)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/marketplace-accounts/oauth/redirect-uri",
      cookies: { accessToken: adminCookie },
    });
    expect(response.json().data.redirectUri).toBe(REDIRECT_URI);
  });

  it("a conta do Mercado Livre exige Client ID e Client Secret — tokens não são digitados", async () => {
    expect((await createAccount({ credential: "texto-solto" })).statusCode).toBe(400);
    expect((await createAccount({ credential: JSON.stringify({ client_id: "1" }) })).statusCode).toBe(400);

    const created = await createAccount();
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ connectionStatus: "disconnected", credentialPreview: "****3906" });
  });

  it("fluxo completo: authorize gera a URL, complete troca o code por tokens e a conta fica conectada", async () => {
    const { id, state } = await startedAccount();
    exchangeCalls.length = 0;

    const authorizeUrl = new URL((await authorize(id)).json().data.authorizationUrl);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://auth.mercadolivre.com.br/authorization");
    expect(Object.fromEntries(authorizeUrl.searchParams)).toMatchObject({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge_method: "S256",
    });
    expect(state).toMatch(/^[0-9a-f]{64}$/);

    const freshState = authorizeUrl.searchParams.get("state")!;
    const response = await complete({ code: "TG-codigo", state: freshState });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ id, connectionStatus: "connected", credentialPreview: "****3906" });
    expect(JSON.stringify(response.json())).not.toContain("APP_USR-access-novo");
    expect(JSON.stringify(response.json())).not.toContain(CLIENT_SECRET);

    // O Mercado Livre foi chamado com o Client ID/Secret cadastrados, o code e o mesmo redirect URI.
    expect(exchangeCalls).toEqual([
      {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        code: "TG-codigo",
        redirectUri: REDIRECT_URI,
        codeVerifier: expect.any(String),
      },
    ]);

    // PKCE: a URL só carrega o hash; o verifier usado na troca é o que gerou aquele challenge, e
    // nunca aparece na URL nem na resposta ao navegador.
    const { codeVerifier } = exchangeCalls[0]!;
    expect(createHash("sha256").update(codeVerifier).digest("base64url")).toBe(
      authorizeUrl.searchParams.get("code_challenge"),
    );
    expect(authorizeUrl.toString()).not.toContain(codeVerifier);
    expect(JSON.stringify(response.json())).not.toContain(codeVerifier);

    // A credencial guardada (cifrada) passa a conter os tokens; o state foi apagado.
    const { getActiveMarketplaceAccountForConnector } = await import("../../src/services/marketplace-account.service.js");
    const stored = JSON.parse((await getActiveMarketplaceAccountForConnector(id)).credential);
    expect(stored).toMatchObject({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      access_token: "APP_USR-access-novo",
      refresh_token: "TG-refresh-novo",
      user_id: 987654,
    });
    expect(new Date(stored.expires_at).getTime()).toBeGreaterThan(Date.now() + 5 * 60 * 60 * 1000);
    const afterConnect = await storedAccount(id);
    expect(afterConnect?.oauthState).toBeUndefined();
    expect(afterConnect?.oauthCodeVerifier).toBeUndefined();
  });

  it("o state é de uso único: repetir o mesmo callback é rejeitado", async () => {
    const { state } = await startedAccount();

    expect((await complete({ code: "TG-1", state })).statusCode).toBe(200);
    const replay = await complete({ code: "TG-1", state });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error).toMatch(/inválida, expirada ou já utilizada/);
  });

  it("state desconhecido ou expirado é rejeitado sem chamar o Mercado Livre", async () => {
    exchangeCalls.length = 0;
    expect((await complete({ code: "TG-1", state: "state-que-nao-existe" })).statusCode).toBe(400);

    const { id, state } = await startedAccount();
    const { getDb } = await import("../../src/database/mongo.client.js");
    const { ObjectId } = await import("mongodb");
    await getDb()
      .collection("marketplace_accounts")
      .updateOne({ _id: new ObjectId(id) }, { $set: { oauthStateExpiresAt: new Date(Date.now() - 1000) } });

    expect((await complete({ code: "TG-1", state })).statusCode).toBe(400);
    expect(exchangeCalls).toHaveLength(0);
  });

  it("recusa do Mercado Livre vira 400 com mensagem clara, sem vazar segredo — e consome o state", async () => {
    const { id, state } = await startedAccount();
    fakeError = new MercadoLivreOAuthError("Client ID ou Client Secret inválido.");

    try {
      const response = await complete({ code: "TG-ruim", state });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("Client ID ou Client Secret inválido.");
      expect(JSON.stringify(response.json())).not.toContain(CLIENT_SECRET);
    } finally {
      fakeError = null;
    }

    expect((await complete({ code: "TG-ruim", state })).statusCode).toBe(400);
    expect((await storedAccount(id))?.connectionStatus).toBe("disconnected");
  });

  it("só contas do Mercado Livre têm OAuth", async () => {
    const shopee = await createAccount({ marketplace: "shopee", credential: "qualquer-credencial" });
    const response = await authorize(shopee.json().data.id);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/só existe para contas do Mercado Livre/);
  });

  it("trocar Client ID/Secret de uma conta conectada a desconecta (tokens antigos eram de outro app)", async () => {
    const { id, state } = await startedAccount();
    await complete({ code: "TG-1", state });

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { credential: mlCredential("7777777777777777", "outro-segredo") },
    });

    expect(patch.json().data).toMatchObject({ connectionStatus: "disconnected", credentialPreview: "****7777" });
    const { getActiveMarketplaceAccountForConnector } = await import("../../src/services/marketplace-account.service.js");
    expect(JSON.parse((await getActiveMarketplaceAccountForConnector(id)).credential)).not.toHaveProperty("access_token");
  });

  it("conectar gera auditoria sem tokens nem segredos", async () => {
    const audit = await app.inject({
      method: "GET",
      url: "/api/audit-logs?action=MARKETPLACE_ACCOUNT_UPDATE",
      cookies: { accessToken: adminCookie },
    });
    const items = audit.json().data.items as { metadata?: { oauthConnected?: boolean } }[];

    expect(items.some((item) => item.metadata?.oauthConnected === true)).toBe(true);
    expect(JSON.stringify(items)).not.toContain("APP_USR-access-novo");
    expect(JSON.stringify(items)).not.toContain(CLIENT_SECRET);
  });
});

describe("usuário do Mercado Livre da conta (spec 012, seção 2.5)", () => {
  async function startedFor(expectedUser?: string) {
    const id = (await createAccount(expectedUser === undefined ? {} : { expectedUser })).json().data.id as string;
    const url = new URL((await authorize(id)).json().data.authorizationUrl);
    return { id, state: url.searchParams.get("state")! };
  }

  async function connectedTokens(id: string) {
    const { getActiveMarketplaceAccountForConnector } = await import("../../src/services/marketplace-account.service.js");
    return JSON.parse((await getActiveMarketplaceAccountForConnector(id)).credential) as Record<string, unknown>;
  }

  it("guarda o usuário esperado no cadastro e o devolve na resposta", async () => {
    const created = await createAccount({ expectedUser: "  OpenErpSampleSalesML " });

    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ expectedUser: "OpenErpSampleSalesML", connectedNickname: null });
  });

  it("confere pelo apelido (sem diferenciar maiúsculas): conecta e guarda quem autorizou", async () => {
    const { id, state } = await startedFor("@openerpsample");
    const response = await complete({ code: "TG-1", state });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ connectionStatus: "connected", connectedNickname: "OPENERPSAMPLE" });
    expect((await storedAccount(id))?.connectedUserId).toBe("987654");
  });

  it("confere pelo ID numérico", async () => {
    const { state } = await startedFor("987654");

    expect((await complete({ code: "TG-1", state })).statusCode).toBe(200);
  });

  it("usuário diferente do esperado: 400 com a mensagem certa e NADA é gravado", async () => {
    const { id, state } = await startedFor("OutraLoja");
    const response = await complete({ code: "TG-1", state });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("OPENERPSAMPLE");
    expect(response.json().error).toContain("987654");
    expect(response.json().error).toContain("OutraLoja");

    const stored = await storedAccount(id);
    expect(stored?.connectionStatus).toBe("disconnected");
    expect(stored?.connectedUserId).toBeUndefined();
    expect(await connectedTokens(id)).not.toHaveProperty("access_token");
    // o state foi consumido: repetir o retorno não reaproveita a autorização
    expect((await complete({ code: "TG-1", state })).statusCode).toBe(400);
  });

  it("conta antiga, sem usuário esperado, conecta sem conferência (mostra 'não informado' na tela)", async () => {
    const { state } = await startedFor();
    const response = await complete({ code: "TG-1", state });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ expectedUser: null, connectedNickname: "OPENERPSAMPLE" });
  });

  it("editar o usuário esperado de uma conta conectada a desconecta e descarta os tokens", async () => {
    const { id, state } = await startedFor("OPENERPSAMPLE");
    await complete({ code: "TG-1", state });

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { expectedUser: "OutraLoja" },
    });

    expect(patch.statusCode).toBe(200);
    expect(patch.json().data).toMatchObject({
      expectedUser: "OutraLoja",
      connectionStatus: "disconnected",
      connectedNickname: null,
    });
    expect(await connectedTokens(id)).toEqual({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  });

  it("reenviar o mesmo usuário esperado não desconecta a conta", async () => {
    const { id, state } = await startedFor("OPENERPSAMPLE");
    await complete({ code: "TG-1", state });

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { expectedUser: "OPENERPSAMPLE" },
    });

    expect(patch.json().data.connectionStatus).toBe("connected");
  });

  it("desconectar limpa a identidade conectada", async () => {
    const { id, state } = await startedFor("OPENERPSAMPLE");
    await complete({ code: "TG-1", state });

    const disconnected = await app.inject({
      method: "POST",
      url: `/api/marketplace-accounts/${id}/disconnect`,
      cookies: { accessToken: adminCookie },
    });

    expect(disconnected.json().data).toMatchObject({ connectionStatus: "disconnected", connectedNickname: null });
    expect((await storedAccount(id))?.connectedUserId).toBeUndefined();
  });

  it("a auditoria de conexão registra o ID do usuário, sem tokens nem segredos", async () => {
    const audit = await app.inject({
      method: "GET",
      url: "/api/audit-logs?action=MARKETPLACE_ACCOUNT_UPDATE",
      cookies: { accessToken: adminCookie },
    });
    const items = audit.json().data.items as { metadata?: { oauthConnected?: boolean; mlUserId?: string } }[];

    expect(items.some((item) => item.metadata?.oauthConnected === true && item.metadata.mlUserId === "987654")).toBe(true);
    expect(JSON.stringify(items)).not.toContain("APP_USR-access-novo");
    expect(JSON.stringify(items)).not.toContain(CLIENT_SECRET);
  });
});
