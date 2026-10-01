/**
 * Cliente HTTP do OAuth 2.0 do Mercado Livre (spec 012, seção 2) — fronteira de rede isolada,
 * substituível em testes (nenhum teste chama o Mercado Livre de verdade).
 *
 * Nunca inclui `client_secret`, `code` ou tokens em mensagens de erro (spec 011, seção 3).
 */

const AUTHORIZATION_URL = "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const CURRENT_USER_URL = "https://api.mercadolibre.com/users/me";
const REQUEST_TIMEOUT_MS = 15_000;

export interface MercadoLivreTokenResponse {
  accessToken: string;
  refreshToken: string;
  /** Segundos de validade do access token (o Mercado Livre devolve 21600 = 6h). */
  expiresIn: number;
  userId: number | string | undefined;
}

export interface ExchangeCodeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  /** PKCE: o segredo cujo hash (S256) foi enviado como `code_challenge` na autorização. */
  codeVerifier: string;
}

export interface RefreshTokenInput {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface MercadoLivreCurrentUser {
  id: number | string;
  nickname: string | undefined;
  /** Ex.: `user_product_seller` — decide o modelo de publicação (spec 012, seção 3.3). */
  tags: string[];
}

export interface MercadoLivreOAuthClient {
  exchangeCode(input: ExchangeCodeInput): Promise<MercadoLivreTokenResponse>;
  /** Token do próprio aplicativo (`client_credentials`) — não exige que nenhuma conta tenha autorizado. */
  requestApplicationToken(input: { clientId: string; clientSecret: string }): Promise<string>;
  /** `GET /users/me` — o teste de integração: só responde 200 se o token for aceito pelo Mercado Livre. */
  fetchCurrentUser(accessToken: string): Promise<MercadoLivreCurrentUser>;
  /**
   * Renova o token de uma conta já conectada (spec 012, seção 2.3). `invalid_grant` (refresh_token
   * gasto ou expirado) lança `MercadoLivreInvalidGrantError`; erro de rede/5xx lança
   * `MercadoLivreOAuthError` comum — a distinção decide se a conta vira `expired`.
   */
  refreshToken(input: RefreshTokenInput): Promise<MercadoLivreTokenResponse>;
}

export class MercadoLivreOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MercadoLivreOAuthError";
  }
}

/**
 * `invalid_grant` na renovação (spec 012, seção 2.3): o `refresh_token` é de uso único — se ele já
 * foi gasto ou expirou (6 meses sem uso), a conta precisa ser reconectada. Distingue de erro
 * transitório (rede, 5xx), que **não** deve marcar a conta como expirada.
 */
export class MercadoLivreInvalidGrantError extends MercadoLivreOAuthError {
  constructor(message: string) {
    super(message);
    this.name = "MercadoLivreInvalidGrantError";
  }
}

/** URL para onde o admin é redirecionado para autorizar o aplicativo (spec 012, seção 2.2). */
export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  /** PKCE (S256): `base64url(SHA-256(code_verifier))`. Aplicativo com `use_pkce` recusa sem isto. */
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZATION_URL}?${params.toString()}`;
}

/** Códigos de erro do Mercado Livre com explicação acionável (spec 012, seção 2 / doc oficial). */
const ERROR_MESSAGES: Record<string, string> = {
  invalid_client: "Client ID ou Client Secret inválido.",
  invalid_grant:
    "Código de autorização inválido, expirado ou já usado — ou o redirect URI do aplicativo não confere. Conecte a conta de novo.",
  invalid_scope: "Escopo solicitado inválido para este aplicativo.",
  invalid_request: "Requisição de autorização malformada.",
  unauthorized_client: "O aplicativo não tem permissão para autorizar esta conta.",
  unauthorized_application: "O aplicativo está bloqueado no Mercado Livre.",
  forbidden: "Acesso negado pelo Mercado Livre (verifique se o app e a conta são válidos).",
  local_rate_limited: "Muitas tentativas seguidas. Aguarde alguns segundos e tente de novo.",
};

async function callMercadoLivre(
  request: () => Promise<Response>,
): Promise<{ response: Response; body: Record<string, unknown> | null }> {
  let response: Response;
  try {
    response = await request();
  } catch {
    throw new MercadoLivreOAuthError("Não foi possível falar com o Mercado Livre. Tente de novo em instantes.");
  }
  return { response, body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

export const mercadoLivreOAuthClient: MercadoLivreOAuthClient = {
  async requestApplicationToken(input) {
    const { response, body } = await callMercadoLivre(() =>
      fetch(TOKEN_URL, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: input.clientId,
          client_secret: input.clientSecret,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );

    if (!response.ok || !body) {
      const code = typeof body?.error === "string" ? body.error : undefined;
      throw new MercadoLivreOAuthError(
        (code && ERROR_MESSAGES[code]) || `O Mercado Livre recusou as credenciais${code ? ` (${code})` : ""}.`,
      );
    }
    if (typeof body.access_token !== "string") {
      throw new MercadoLivreOAuthError("Resposta inesperada do Mercado Livre ao autenticar o aplicativo.");
    }
    return body.access_token;
  },

  async fetchCurrentUser(accessToken) {
    const { response, body } = await callMercadoLivre(() =>
      fetch(CURRENT_USER_URL, {
        headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );

    if (!response.ok || !body) {
      throw new MercadoLivreOAuthError(
        response.status === 401 || response.status === 403
          ? "O Mercado Livre recusou o token em GET /users/me. Confira o Client ID e o Client Secret."
          : `GET /users/me falhou no Mercado Livre (HTTP ${response.status}).`,
      );
    }
    if (typeof body.id !== "number" && typeof body.id !== "string") {
      throw new MercadoLivreOAuthError("Resposta inesperada do Mercado Livre em GET /users/me.");
    }
    return {
      id: body.id,
      nickname: typeof body.nickname === "string" ? body.nickname : undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [],
    };
  },

  async exchangeCode(input) {
    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
          code_verifier: input.codeVerifier,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new MercadoLivreOAuthError("Não foi possível falar com o Mercado Livre. Tente de novo em instantes.");
    }

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!response.ok || !body) {
      const code = typeof body?.error === "string" ? body.error : undefined;
      throw new MercadoLivreOAuthError(
        (code && ERROR_MESSAGES[code]) || `O Mercado Livre recusou a autorização${code ? ` (${code})` : ""}.`,
      );
    }

    const { access_token, refresh_token, expires_in, user_id } = body;
    if (typeof access_token !== "string" || typeof refresh_token !== "string" || typeof expires_in !== "number") {
      throw new MercadoLivreOAuthError("Resposta inesperada do Mercado Livre ao trocar o código por tokens.");
    }

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      userId: typeof user_id === "number" || typeof user_id === "string" ? user_id : undefined,
    };
  },

  async refreshToken(input) {
    const { response, body } = await callMercadoLivre(() =>
      fetch(TOKEN_URL, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          refresh_token: input.refreshToken,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );

    if (!response.ok || !body) {
      const code = typeof body?.error === "string" ? body.error : undefined;
      const message = (code && ERROR_MESSAGES[code]) || `O Mercado Livre recusou a renovação${code ? ` (${code})` : ""}.`;
      if (code === "invalid_grant") throw new MercadoLivreInvalidGrantError(message);
      throw new MercadoLivreOAuthError(message);
    }

    const { access_token, refresh_token, expires_in, user_id } = body;
    if (typeof access_token !== "string" || typeof refresh_token !== "string" || typeof expires_in !== "number") {
      throw new MercadoLivreOAuthError("Resposta inesperada do Mercado Livre ao renovar o token.");
    }

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      userId: typeof user_id === "number" || typeof user_id === "string" ? user_id : undefined,
    };
  },
};
