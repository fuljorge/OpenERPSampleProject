import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../database/mongo.client.js";
import {
  buildAuthorizationUrl,
  mercadoLivreOAuthClient,
  type MercadoLivreOAuthClient,
} from "../plugins/marketplaces/mercado-livre-oauth.client.js";
import { marketplaceAccountRepository } from "../repositories/marketplace-account.repository.js";
import { parseMercadoLivreCredential, type MercadoLivreCredential } from "../schemas/mercado-livre-credential.schema.js";
import type { MarketplaceAccount as MarketplaceAccountOutput } from "../schemas/marketplace-account.schema.js";
import { record } from "./audit-log.service.js";
import { matchesExpectedUser, type MercadoLivreUserIdentity } from "./mercado-livre-user-match.js";
import { decryptCredential, encryptCredential } from "./credential-encryption.service.js";
import {
  InvalidCredentialFormatError,
  MarketplaceAccountNotFoundError,
  presentMarketplaceAccount,
} from "./marketplace-account.service.js";

/**
 * Cadastro de conta do Mercado Livre por OAuth 2.0 Authorization Code (spec 012, seção 2.2): o
 * admin informa só Client ID e Client Secret; os tokens vêm do Mercado Livre, nunca são digitados.
 *
 *   1. start:    gera `state` e PKCE (`code_verifier`) de uso único (10 min) e devolve a URL de autorização
 *   2. o admin autoriza no Mercado Livre, que redireciona de volta com ?code=...&state=...
 *   3. complete: consome o `state`, troca o `code` por access/refresh token e grava a credencial
 */

const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_LIFETIME_FALLBACK_S = 6 * 60 * 60;
const CALLBACK_PATH = "/admin/marketplace-accounts/oauth/callback";

export class OAuthNotSupportedError extends Error {
  constructor() {
    super("Conexão por OAuth só existe para contas do Mercado Livre.");
    this.name = "OAuthNotSupportedError";
  }
}

export class InvalidOAuthStateError extends Error {
  constructor() {
    super("Autorização inválida, expirada ou já utilizada. Clique em Conectar de novo.");
    this.name = "InvalidOAuthStateError";
  }
}

/** Quem autorizou o aplicativo no Mercado Livre não é o usuário configurado na conta (spec 012, seção 2.5). */
export class UnexpectedMercadoLivreUserError extends Error {
  constructor(authorized: MercadoLivreUserIdentity, expected: string) {
    super(
      `O Mercado Livre autorizou o usuário ${authorized.nickname ?? "(sem apelido)"} (ID ${authorized.id}), mas esta conta está configurada para ${expected}. Saia do Mercado Livre e conecte de novo com o usuário correto.`,
    );
    this.name = "UnexpectedMercadoLivreUserError";
  }
}

let client: MercadoLivreOAuthClient = mercadoLivreOAuthClient;

/** Seam de teste — nenhum teste chama a API real do Mercado Livre. */
export function setMercadoLivreOAuthClientForTesting(fake: MercadoLivreOAuthClient): void {
  client = fake;
}

/**
 * Página do próprio ERP para onde o Mercado Livre devolve o admin (deve ser cadastrada, exatamente
 * assim, como "URL de redirecionamento" no aplicativo do Mercado Livre — sem parâmetros variáveis).
 * Derivada de `FRONTEND_URL`, a mesma origem já usada pelo CORS.
 */
export function getMercadoLivreRedirectUri(): string {
  const base = process.env.FRONTEND_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("FRONTEND_URL não configurada (necessária para o redirect URI do OAuth).");
  return `${base}${CALLBACK_PATH}`;
}

async function loadClientCredential(accountId: string) {
  const db = getDb();
  const account = await marketplaceAccountRepository.findById(db, accountId);
  if (!account || !account.active) throw new MarketplaceAccountNotFoundError();
  if (account.marketplace !== "mercado_livre") throw new OAuthNotSupportedError();
  return { db, account, credential: await readCredential(account.credential) };
}

async function readCredential(ciphertext: string): Promise<MercadoLivreCredential> {
  const credential = parseMercadoLivreCredential(await decryptCredential(ciphertext));
  if (!credential) {
    throw new InvalidCredentialFormatError("Informe o Client ID e o Client Secret do aplicativo do Mercado Livre.");
  }
  return credential;
}

/**
 * Teste de integração do formulário de cadastro (spec 012, seção 2.4): com só Client ID e Client
 * Secret, obtém um token do aplicativo e chama `GET /users/me`. Não grava nada — o cadastro só é
 * liberado no frontend depois que isto passa.
 */
export async function testMercadoLivreIntegration(input: {
  clientId: string;
  clientSecret: string;
}): Promise<{ userId: number | string; nickname: string | undefined }> {
  const accessToken = await client.requestApplicationToken(input);
  const user = await client.fetchCurrentUser(accessToken);
  return { userId: user.id, nickname: user.nickname };
}

export async function startMercadoLivreAuthorization(
  accountId: string,
): Promise<{ authorizationUrl: string; redirectUri: string }> {
  const { db, account, credential } = await loadClientCredential(accountId);

  const state = randomBytes(32).toString("hex");
  // PKCE (S256): só o hash do verifier sai daqui; o verifier fica no servidor até a troca do code.
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  await marketplaceAccountRepository.setOAuthState(
    db,
    account.id,
    state,
    new Date(Date.now() + STATE_TTL_MS),
    codeVerifier,
  );

  const redirectUri = getMercadoLivreRedirectUri();
  return {
    authorizationUrl: buildAuthorizationUrl({ clientId: credential.client_id, redirectUri, state, codeChallenge }),
    redirectUri,
  };
}

export async function completeMercadoLivreAuthorization(
  input: { code: string; state: string },
  actingAdminId: string,
): Promise<MarketplaceAccountOutput> {
  const db = getDb();

  // O state é consumido antes de qualquer chamada externa: uso único, mesmo se a troca falhar.
  const consumed = await marketplaceAccountRepository.consumeOAuthState(db, input.state);
  if (
    !consumed ||
    !consumed.expiresAt ||
    !consumed.codeVerifier ||
    consumed.expiresAt.getTime() < Date.now() ||
    !consumed.account.active
  ) {
    throw new InvalidOAuthStateError();
  }
  const { account } = consumed;
  const credential = await readCredential(account.credential);

  const tokens = await client.exchangeCode({
    clientId: credential.client_id,
    clientSecret: credential.client_secret,
    code: input.code,
    redirectUri: getMercadoLivreRedirectUri(),
    codeVerifier: consumed.codeVerifier,
  });

  // Confere quem autorizou (spec 012, seção 2.5) ANTES de gravar qualquer coisa: se for outro usuário,
  // os tokens são descartados. Contas antigas, sem usuário esperado, não são conferidas.
  const authorizedUser = await client.fetchCurrentUser(tokens.accessToken);
  if (account.expectedUser && !matchesExpectedUser(account.expectedUser, authorizedUser)) {
    throw new UnexpectedMercadoLivreUserError(authorizedUser, account.expectedUser);
  }

  const connected: MercadoLivreCredential = {
    client_id: credential.client_id,
    client_secret: credential.client_secret,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: new Date(Date.now() + (tokens.expiresIn || TOKEN_LIFETIME_FALLBACK_S) * 1000).toISOString(),
    ...(tokens.userId !== undefined ? { user_id: tokens.userId } : {}),
  };
  await marketplaceAccountRepository.saveConnectedCredential(db, account.id, await encryptCredential(JSON.stringify(connected)), {
    userId: String(authorizedUser.id),
    nickname: authorizedUser.nickname,
  });

  // Nunca registra tokens nem segredos — só o fato de que a conta foi conectada.
  await record("MARKETPLACE_ACCOUNT_UPDATE", "marketplace_account", account.id, actingAdminId, {
    oauthConnected: true,
    mlUserId: String(authorizedUser.id),
  });

  const updated = await marketplaceAccountRepository.findById(db, account.id);
  if (!updated) throw new MarketplaceAccountNotFoundError();
  return presentMarketplaceAccount(updated);
}
