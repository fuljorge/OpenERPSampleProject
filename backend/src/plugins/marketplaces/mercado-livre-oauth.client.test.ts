import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MercadoLivreInvalidGrantError,
  MercadoLivreOAuthError,
  buildAuthorizationUrl,
  mercadoLivreOAuthClient,
} from "./mercado-livre-oauth.client.js";

const input = {
  clientId: "1620218256833906",
  clientSecret: "SEGREDO-NAO-VAZAR",
  code: "TG-codigo-de-autorizacao",
  redirectUri: "https://erp.example.com/admin/marketplace-accounts/oauth/callback",
  codeVerifier: "verifier-pkce-de-teste",
};

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("buildAuthorizationUrl", () => {
  it("monta a URL de autorização do Mercado Livre com client_id, redirect_uri, state e PKCE (S256)", () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: "123",
        redirectUri: "https://x.com/cb",
        state: "abc",
        codeChallenge: "challenge-xyz",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://auth.mercadolivre.com.br/authorization");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "123",
      redirect_uri: "https://x.com/cb",
      state: "abc",
      code_challenge: "challenge-xyz",
      code_challenge_method: "S256",
    });
  });
});

describe("teste de integração do Mercado Livre", () => {
  it("requestApplicationToken: POST form com grant_type=client_credentials e devolve só o access token", async () => {
    const fetchMock = stubFetch(200, { access_token: "APP_USR-app", token_type: "Bearer", expires_in: 21600 });

    await expect(
      mercadoLivreOAuthClient.requestApplicationToken({ clientId: input.clientId, clientSecret: input.clientSecret }),
    ).resolves.toBe("APP_USR-app");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadolibre.com/oauth/token");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: "client_credentials",
      client_id: input.clientId,
      client_secret: input.clientSecret,
    });
  });

  it("requestApplicationToken: credenciais inválidas viram mensagem acionável sem o secret", async () => {
    stubFetch(400, { error: "invalid_client", message: "invalid client_id or client_secret" });
    const error = await mercadoLivreOAuthClient
      .requestApplicationToken({ clientId: input.clientId, clientSecret: input.clientSecret })
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      );

    expect(error).toBeInstanceOf(MercadoLivreOAuthError);
    expect(error.message).toBe("Client ID ou Client Secret inválido.");
    expect(error.message).not.toContain(input.clientSecret);
  });

  it("fetchCurrentUser: GET /users/me com Authorization: Bearer", async () => {
    const fetchMock = stubFetch(200, { id: 1234567, nickname: "OPENERPSAMPLE" });

    await expect(mercadoLivreOAuthClient.fetchCurrentUser("APP_USR-abc")).resolves.toEqual({
      id: 1234567,
      nickname: "OPENERPSAMPLE",
      tags: [],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadolibre.com/users/me");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer APP_USR-abc");
  });

  it("fetchCurrentUser: devolve as tags (ex.: user_product_seller, spec 012, seção 3.3)", async () => {
    stubFetch(200, { id: 1234567, nickname: "OPENERPSAMPLE", tags: ["user_product_seller", "normal"] });

    await expect(mercadoLivreOAuthClient.fetchCurrentUser("APP_USR-abc")).resolves.toEqual({
      id: 1234567,
      nickname: "OPENERPSAMPLE",
      tags: ["user_product_seller", "normal"],
    });
  });

  it("fetchCurrentUser: 401/403, outros HTTP e corpo inesperado são falhas do teste", async () => {
    stubFetch(401, { code: "unauthorized", message: "invalid access token" });
    await expect(mercadoLivreOAuthClient.fetchCurrentUser("ruim")).rejects.toThrow(/recusou o token/);

    stubFetch(500, { message: "erro" });
    await expect(mercadoLivreOAuthClient.fetchCurrentUser("x")).rejects.toThrow(/HTTP 500/);

    stubFetch(200, { nickname: "sem-id" });
    await expect(mercadoLivreOAuthClient.fetchCurrentUser("x")).rejects.toThrow(/Resposta inesperada/);
  });
});

describe("mercadoLivreOAuthClient.exchangeCode", () => {
  it("troca o code por tokens: POST form-urlencoded em /oauth/token com grant_type=authorization_code e code_verifier", async () => {
    const fetchMock = stubFetch(200, {
      access_token: "APP_USR-token",
      refresh_token: "TG-refresh",
      expires_in: 21600,
      user_id: 1234567,
    });

    const tokens = await mercadoLivreOAuthClient.exchangeCode(input);

    expect(tokens).toEqual({ accessToken: "APP_USR-token", refreshToken: "TG-refresh", expiresIn: 21600, userId: 1234567 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadolibre.com/oauth/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    });
  });

  it("traduz os códigos de erro do Mercado Livre para mensagens acionáveis", async () => {
    stubFetch(400, { error: "invalid_grant", error_description: "Error validating grant", status: 400 });
    await expect(mercadoLivreOAuthClient.exchangeCode(input)).rejects.toThrow(/redirect URI/);

    stubFetch(401, { error: "invalid_client" });
    await expect(mercadoLivreOAuthClient.exchangeCode(input)).rejects.toThrow(/Client ID ou Client Secret inválido/);
  });

  it("nunca inclui client_secret nem code nas mensagens de erro", async () => {
    stubFetch(400, { error: "algum_erro_desconhecido" });
    const error = await mercadoLivreOAuthClient.exchangeCode(input).then(
      () => new Error("deveria ter falhado"),
      (err: Error) => err,
    );

    expect(error).toBeInstanceOf(MercadoLivreOAuthError);
    expect(error.message).toContain("algum_erro_desconhecido");
    expect(error.message).not.toContain(input.clientSecret);
    expect(error.message).not.toContain(input.code);
  });

  it("falha de rede ou resposta com formato inesperado viram erro claro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expect(mercadoLivreOAuthClient.exchangeCode(input)).rejects.toThrow(/Não foi possível falar com o Mercado Livre/);

    stubFetch(200, { access_token: "so-o-access" });
    await expect(mercadoLivreOAuthClient.exchangeCode(input)).rejects.toThrow(/Resposta inesperada/);
  });
});

describe("mercadoLivreOAuthClient.refreshToken (spec 012, seção 2.3)", () => {
  it("POST form-urlencoded em /oauth/token com grant_type=refresh_token", async () => {
    const fetchMock = stubFetch(200, {
      access_token: "APP_USR-novo",
      refresh_token: "TG-novo",
      expires_in: 21600,
      user_id: 1234567,
    });

    const tokens = await mercadoLivreOAuthClient.refreshToken({
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      refreshToken: "TG-antigo",
    });

    expect(tokens).toEqual({ accessToken: "APP_USR-novo", refreshToken: "TG-novo", expiresIn: 21600, userId: 1234567 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadolibre.com/oauth/token");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: "refresh_token",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: "TG-antigo",
    });
  });

  it("invalid_grant (refresh_token gasto ou expirado) lança MercadoLivreInvalidGrantError", async () => {
    stubFetch(400, { error: "invalid_grant", message: "invalid refresh token" });

    const error = await mercadoLivreOAuthClient
      .refreshToken({ clientId: input.clientId, clientSecret: input.clientSecret, refreshToken: "TG-usado" })
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      );

    expect(error).toBeInstanceOf(MercadoLivreInvalidGrantError);
    expect(error).toBeInstanceOf(MercadoLivreOAuthError);
  });

  it("erro de rede ou 5xx NÃO é MercadoLivreInvalidGrantError (não deve marcar a conta como expirada)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const networkError = await mercadoLivreOAuthClient
      .refreshToken({ clientId: input.clientId, clientSecret: input.clientSecret, refreshToken: "TG-x" })
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      );
    expect(networkError).toBeInstanceOf(MercadoLivreOAuthError);
    expect(networkError).not.toBeInstanceOf(MercadoLivreInvalidGrantError);

    stubFetch(500, {});
    const serverError = await mercadoLivreOAuthClient
      .refreshToken({ clientId: input.clientId, clientSecret: input.clientSecret, refreshToken: "TG-x" })
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      );
    expect(serverError).not.toBeInstanceOf(MercadoLivreInvalidGrantError);
  });

  it("nunca inclui client_secret nem refresh_token nas mensagens de erro", async () => {
    stubFetch(400, { error: "invalid_grant" });

    const error = await mercadoLivreOAuthClient
      .refreshToken({ clientId: input.clientId, clientSecret: input.clientSecret, refreshToken: "TG-secreto-nao-vazar" })
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      );

    expect(error.message).not.toContain(input.clientSecret);
    expect(error.message).not.toContain("TG-secreto-nao-vazar");
  });

  it("resposta com formato inesperado vira erro claro", async () => {
    stubFetch(200, { access_token: "só-o-access" });

    await expect(
      mercadoLivreOAuthClient.refreshToken({ clientId: input.clientId, clientSecret: input.clientSecret, refreshToken: "TG-x" }),
    ).rejects.toThrow(/Resposta inesperada/);
  });
});
