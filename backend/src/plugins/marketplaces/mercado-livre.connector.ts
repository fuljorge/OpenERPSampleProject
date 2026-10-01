import {
  MercadoLivreInvalidGrantError,
  mercadoLivreOAuthClient,
  type MercadoLivreTokenResponse,
} from "./mercado-livre-oauth.client.js";
import * as api from "./mercado-livre-api.client.js";
import {
  MarketplaceConnectorError,
  type CloseInput,
  type ConnectorOutcome,
  type MarketplaceCloseResult,
  type MarketplaceConnectorPort,
  type MarketplacePublishResult,
  type PublishInput,
} from "./marketplace-connector.port.js";
import { parseMercadoLivreCredential, type MercadoLivreCredential } from "../../schemas/mercado-livre-credential.schema.js";
import {
  publishItem,
  resolveAttributeSuggestion,
  resolveSizeSuggestion,
  resolveShippingSuggestion,
  type MarketplaceSizeSuggestion,
  type ShippingSuggestionOption,
} from "./mercado-livre-publish.js";
import type { PendingRequiredAttribute } from "./mercado-livre-item.mapper.js";
import type { Product } from "../../schemas/product.schema.js";

export type { MarketplaceSizeSuggestion, PendingRequiredAttribute, ShippingSuggestionOption };

/**
 * Adaptador do Mercado Livre (spec 012) — implementa `MarketplaceConnectorPort` (011, seção 4.1).
 * `publish` (criar/atualizar anúncio) delega a orquestração para `mercado-livre-publish.ts`
 * (T025/T026), que usa o mapeador puro (T023) e a API (T022). `close` (encerrar anúncio) está
 * completo desde a Fase 4.
 *
 * Renovação de token (spec 012, seção 2.3): proativa quando `expires_at` está a menos de 5 min, e
 * reativa quando a chamada responde `401`. O par novo vai sempre em `updatedCredential` — no
 * sucesso e no erro — para o serviço gravar (o `refresh_token` do Mercado Livre é de uso único).
 */

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

function mergeRefreshedCredential(base: MercadoLivreCredential, refreshed: MercadoLivreTokenResponse): MercadoLivreCredential {
  return {
    ...base,
    access_token: refreshed.accessToken,
    refresh_token: refreshed.refreshToken,
    expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
    ...(refreshed.userId !== undefined ? { user_id: refreshed.userId } : {}),
  };
}

async function refreshTokenOrThrow(credential: MercadoLivreCredential): Promise<MercadoLivreTokenResponse> {
  try {
    return await mercadoLivreOAuthClient.refreshToken({
      clientId: credential.client_id,
      clientSecret: credential.client_secret,
      refreshToken: credential.refresh_token!,
    });
  } catch (err) {
    if (err instanceof MercadoLivreInvalidGrantError) {
      throw new MarketplaceConnectorError(
        "O Mercado Livre recusou a renovação do token (refresh token expirado ou já usado). Reconecte a conta.",
        { reconnectRequired: true },
      );
    }
    throw new MarketplaceConnectorError(
      err instanceof Error ? err.message : "Falha ao renovar o token do Mercado Livre.",
    );
  }
}

interface FreshToken {
  credential: MercadoLivreCredential;
  accessToken: string;
  /** Presente só se esta chamada de fato renovou o token. */
  updatedCredential: string | undefined;
}

/** Decodifica a credencial e renova o token se estiver a menos de 5 min de expirar. */
async function ensureFreshToken(credentialJson: string): Promise<FreshToken> {
  const credential = parseMercadoLivreCredential(credentialJson);
  if (!credential || !credential.access_token || !credential.refresh_token) {
    throw new MarketplaceConnectorError(
      "Conta não conectada ao Mercado Livre. Conecte a conta antes de publicar ou encerrar um anúncio.",
      { reconnectRequired: true },
    );
  }

  const expiresAtMs = credential.expires_at ? new Date(credential.expires_at).getTime() : 0;
  const needsRefresh = !credential.expires_at || Number.isNaN(expiresAtMs) || expiresAtMs - Date.now() < TOKEN_REFRESH_MARGIN_MS;
  if (!needsRefresh) {
    return { credential, accessToken: credential.access_token, updatedCredential: undefined };
  }

  const refreshed = await refreshTokenOrThrow(credential);
  const nextCredential = mergeRefreshedCredential(credential, refreshed);
  return { credential: nextCredential, accessToken: refreshed.accessToken, updatedCredential: JSON.stringify(nextCredential) };
}

function wrapAsConnectorError(err: unknown, updatedCredential: string | undefined): MarketplaceConnectorError {
  if (err instanceof MarketplaceConnectorError) {
    if (err.updatedCredential === undefined && updatedCredential !== undefined) {
      return new MarketplaceConnectorError(err.message, { updatedCredential, reconnectRequired: err.reconnectRequired });
    }
    return err;
  }
  const message = err instanceof Error ? err.message : "Falha desconhecida ao falar com o Mercado Livre.";
  return new MarketplaceConnectorError(message, { updatedCredential });
}

/**
 * Roda `call` com um token válido; um `401` força a renovação e repete **uma vez** (spec 012, seção
 * 2.3). Qualquer falha carrega o `updatedCredential` da renovação que tiver ocorrido antes dela —
 * mesmo quando `call` falha depois de o token já ter sido trocado.
 */
async function callWithFreshToken<T>(
  credentialJson: string,
  call: (accessToken: string) => Promise<T>,
): Promise<ConnectorOutcome<T>> {
  const initial = await ensureFreshToken(credentialJson);

  try {
    const value = await call(initial.accessToken);
    return { value, updatedCredential: initial.updatedCredential };
  } catch (err) {
    if (!(err instanceof api.MercadoLivreApiError) || err.status !== 401) {
      throw wrapAsConnectorError(err, initial.updatedCredential);
    }
  }

  // 401: renova à força (mesmo que expires_at parecesse válido) e repete a chamada 1×.
  const refreshed = await refreshTokenOrThrow(initial.credential);
  const nextCredential = mergeRefreshedCredential(initial.credential, refreshed);
  const updatedCredential = JSON.stringify(nextCredential);

  try {
    const value = await call(refreshed.accessToken);
    return { value, updatedCredential };
  } catch (err) {
    throw wrapAsConnectorError(err, updatedCredential);
  }
}

async function publish(input: PublishInput): Promise<ConnectorOutcome<MarketplacePublishResult>> {
  return callWithFreshToken(input.credential, (accessToken) => publishItem(accessToken, input));
}

async function close(input: CloseInput): Promise<ConnectorOutcome<MarketplaceCloseResult>> {
  const itemId = input.listing.id_anuncio;
  if (!itemId) {
    throw new MarketplaceConnectorError("Este anúncio não tem um id do Mercado Livre associado — não é possível encerrá-lo.");
  }

  return callWithFreshToken(input.credential, async (accessToken) => {
    await api.closeItem(accessToken, itemId);
    return { encerrado: true as const };
  });
}

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
}

/**
 * Sugestão de categoria para a tela de revisão (spec 012, seção 4; ADR-025) — **fora** da porta
 * comum (`MarketplaceConnectorPort`), de propósito: é um passo específico do Mercado Livre, não
 * uma operação que todo conector precisa ter (spec 011, seção 4.1). Chamado pelo serviço de
 * sugestão (`marketplace-category-suggestion.service.ts`), nunca pelo `publish()` em si — a
 * escolha da categoria já vem pronta quando `publish()` é chamado.
 */
export async function suggestCategory(credentialJson: string, productName: string): Promise<ConnectorOutcome<CategorySuggestion | null>> {
  return callWithFreshToken(credentialJson, async (accessToken) => {
    const prediction = await api.predictCategory(accessToken, productName);
    return prediction ? { categoryId: prediction.categoryId, categoryName: prediction.categoryName } : null;
  });
}

/**
 * Sugestão de tamanho pra tela de revisão (spec 012, calçado; ADR-032, roupa) — mesmo espírito
 * de `suggestCategory`: fora da porta comum, só consulta, nunca publica. Chamado pelo serviço
 * de sugestão (`marketplace-size-suggestion.service.ts`) depois que o operador escolhe/confirma
 * a categoria, nunca pelo `publish()` em si.
 */
export async function suggestSizes(
  credentialJson: string,
  product: Product,
  categoryId: string,
): Promise<ConnectorOutcome<MarketplaceSizeSuggestion>> {
  return callWithFreshToken(credentialJson, (accessToken) => resolveSizeSuggestion(accessToken, product, categoryId));
}

/**
 * Sugestão de frete pra tela de revisão (spec 012, achado real 24/09/2026) — mesmo espírito de
 * `suggestSizes`/`suggestCategory`: fora da porta comum, só consulta, nunca publica.
 * Chamado depois que o operador já escolheu categoria, tamanho (se aplicável) e tipo de anúncio.
 */
export async function suggestShipping(
  credentialJson: string,
  product: Product,
  categoryId: string,
  listingTypeId: string,
): Promise<ConnectorOutcome<ShippingSuggestionOption[]>> {
  return callWithFreshToken(credentialJson, (accessToken) => resolveShippingSuggestion(accessToken, product, categoryId, listingTypeId));
}

/**
 * Atributos obrigatórios da categoria que o cadastro não cobre, pra revisão (ADR-035) — mesmo
 * espírito de `suggestSizes`/`suggestShipping`: fora da porta comum, só consulta.
 */
export async function suggestAttributes(
  credentialJson: string,
  product: Product,
  categoryId: string,
): Promise<ConnectorOutcome<PendingRequiredAttribute[]>> {
  return callWithFreshToken(credentialJson, (accessToken) => resolveAttributeSuggestion(accessToken, product, categoryId));
}

export const mercadoLivreConnector: MarketplaceConnectorPort = { publish, close };
