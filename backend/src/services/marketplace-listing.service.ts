import { getDb } from "../database/mongo.client.js";
import { productRepository } from "../repositories/product.repository.js";
import { marketplaceAccountRepository, type MarketplaceAccountRecord } from "../repositories/marketplace-account.repository.js";
import { getProductById } from "./product.service.js";
import { AccountBusyError, runAccountOperation } from "./account-operation.service.js";
import { MarketplaceAccountNotFoundError } from "./marketplace-account.service.js";
import type { Marketplace } from "../schemas/marketplace-account.schema.js";
import type { Product } from "../schemas/product.schema.js";
import { getConnector, setMarketplaceConnectorForTesting } from "../plugins/marketplaces/connector-registry.js";
import type { ConnectorAccount } from "../plugins/marketplaces/marketplace-connector.port.js";
import { record } from "./audit-log.service.js";

export class ProductMissingRequiredFieldsError extends Error {
  constructor(missing: string[]) {
    super(`Dados mínimos incompletos para publicar: ${missing.join(", ")}.`);
    this.name = "ProductMissingRequiredFieldsError";
  }
}

export class MarketplaceAccountMismatchError extends Error {
  constructor() {
    super("A conta escolhida não pertence ao marketplace selecionado.");
    this.name = "MarketplaceAccountMismatchError";
  }
}

/** Encerrar exige uma publicação `publicado` (spec 011, seção 4.7) — sem chamar o conector. */
export class ListingNotPublishedError extends Error {
  constructor() {
    super("Esta publicação não está no ar — não é possível encerrá-la.");
    this.name = "ListingNotPublishedError";
  }
}

/** Conta inativa ou não conectada: encerrar exige as duas (spec 011, seção 4.7) — sem chamar o conector. */
export class AccountNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountNotReadyError";
  }
}

/**
 * O conector de cada marketplace vem do registro (`plugins/marketplaces/connector-registry.ts`). Um
 * marketplace sem conector **não finge sucesso**: `getConnector` lança um erro claro, que
 * `publishListing`/`closeListing` gravam como `erro` na entrada (spec 011, seção 4.6). O seam de
 * teste segue exportado daqui para não mexer nos testes existentes.
 */
export { setMarketplaceConnectorForTesting };

/** A conta como o conector a vê: sem a credencial cifrada (ela chega decifrada, à parte). */
function toConnectorAccount(account: MarketplaceAccountRecord): ConnectorAccount {
  return {
    id: account.id,
    marketplace: account.marketplace,
    label: account.label,
    credentialPreview: account.credentialPreview,
    connectionStatus: account.connectionStatus,
    active: account.active,
    expectedUser: account.expectedUser,
    connectedNickname: account.connectedNickname,
    createdBy: account.createdBy,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

/** Dados mínimos obrigatórios para publicar (spec 011, seção 4.6). */
function assertMinimumProductData(product: Product): void {
  const missing: string[] = [];
  if (!product.identificacao.nome?.trim()) missing.push("nome");
  if (!product.classificacao.categoria_codigo) missing.push("categoria");
  if (product.preco.preco_venda === null || product.preco.preco_venda === undefined) {
    missing.push("preço de venda");
  }
  if (product.imagens.galeria.length === 0) missing.push("ao menos uma foto");

  if (missing.length > 0) {
    throw new ProductMissingRequiredFieldsError(missing);
  }
}

export interface PublishListingInput {
  productId: string;
  marketplace: Marketplace;
  accountId: string;
  actingUserId: string;
  /** Categoria já confirmada na tela de revisão (spec 012, seção 4; ADR-025) — repassada como veio. */
  categoryId?: string | null;
  /** Tipo de anúncio já escolhido na mesma tela de revisão (spec 012, seção 3.2; ADR-026). */
  listingTypeId?: string | null;
  /** Tamanho de calçado escolhido na revisão quando o do cadastro não bate com a tabela do
   * Mercado Livre (spec 012, achado real 24/09/2026). */
  sizeOverride?: string | null;
  /** Frete escolhido na tela de revisão (spec 012, achado real 24/09/2026). */
  shipping?: { mode: string; logisticType: string; freeShipping: boolean } | null;
  /** Obrigatórios da categoria escolhidos na revisão (ADR-035). */
  extraAttributes?: { id: string; valueId?: string | null; valueName: string }[] | null;
}

/**
 * Publica (ou retenta) uma publicação de produto num marketplace, através da conta escolhida.
 * Falha do conector nunca é silenciosa (spec 011, seção 4.6): grava `status = erro` (entrada nova)
 * ou preserva o `status` anterior com `erro` preenchido (entrada que já tinha `id_anuncio` — spec
 * 012, seção 3.1: republicar/recriar que falha não derruba um anúncio no ar nem apaga o histórico
 * de um encerrado) — sem lançar para o chamador; a falha é um resultado de negócio válido, não uma
 * exceção da rota. `AccountBusyError` (409, outra operação em andamento na conta) é a exceção:
 * propaga, sem gravar nada — não houve tentativa real.
 */
export async function publishListing(input: PublishListingInput): Promise<Product> {
  const product = await getProductById(input.productId);
  assertMinimumProductData(product);

  const db = getDb();
  const account = await marketplaceAccountRepository.findById(db, input.accountId);
  if (!account || !account.active) throw new MarketplaceAccountNotFoundError();
  if (account.marketplace !== input.marketplace) throw new MarketplaceAccountMismatchError();

  // Entrada atual desta conta no produto: é ela que o conector usa para decidir criar × atualizar
  // × recriar (spec 012, seção 3.1), e o que a falha preserva.
  const existing = product.marketplaces.find((l) => l.marketplace === input.marketplace && l.conta_id === account.id) ?? null;
  const retryingExistingAd = existing !== null && existing.id_anuncio !== null;

  try {
    const result = await runAccountOperation(input.accountId, ({ account: freshAccount, credential }) =>
      getConnector(input.marketplace).publish({
        product,
        listing: existing,
        account: toConnectorAccount(freshAccount),
        credential,
        categoryId: input.categoryId,
        listingTypeId: input.listingTypeId,
        sizeOverride: input.sizeOverride,
        shipping: input.shipping,
        extraAttributes: input.extraAttributes,
      }),
    );

    await productRepository.upsertMarketplaceListing(db, input.productId, {
      marketplace: input.marketplace,
      conta_id: account.id,
      conta_apelido: account.label,
      status: "publicado",
      id_anuncio: result.id_anuncio,
      url_anuncio: result.url_anuncio,
      publicado_em: new Date(),
      encerrado_em: null,
      // Pendência com o anúncio no ar (ex.: descrição não enviada) — spec 012, seção 3.1.
      erro: result.pendencia,
    });

    await record("PRODUCT_PUBLISH", "product", input.productId, input.actingUserId, {
      marketplace: input.marketplace,
      accountId: account.id,
      success: true,
    });
  } catch (err) {
    if (err instanceof AccountBusyError) throw err;

    // Nunca logar `credential` (spec 011, seção 3) — só a mensagem de erro do conector.
    const message = err instanceof Error ? err.message : "Falha desconhecida ao publicar.";

    await productRepository.upsertMarketplaceListing(db, input.productId, {
      marketplace: input.marketplace,
      conta_id: account.id,
      conta_apelido: account.label,
      status: retryingExistingAd ? existing!.status : "erro",
      id_anuncio: retryingExistingAd ? existing!.id_anuncio : null,
      url_anuncio: retryingExistingAd ? existing!.url_anuncio : null,
      publicado_em: retryingExistingAd ? existing!.publicado_em : null,
      encerrado_em: retryingExistingAd ? existing!.encerrado_em : null,
      erro: message,
    });

    await record("PRODUCT_PUBLISH", "product", input.productId, input.actingUserId, {
      marketplace: input.marketplace,
      accountId: account.id,
      success: false,
      error: message,
    });
  }

  return getProductById(input.productId);
}

export interface CloseListingInput {
  productId: string;
  marketplace: Marketplace;
  accountId: string;
  actingUserId: string;
}

/**
 * Encerra um anúncio `publicado` (spec 011, seção 4.7). Falha nunca é silenciosa: a entrada segue
 * `publicado`, com `erro` = "Falha ao encerrar: …" e a opção de tentar de novo. `AccountBusyError`
 * propaga (409), sem gravar nada.
 */
export async function closeListing(input: CloseListingInput): Promise<Product> {
  const product = await getProductById(input.productId);
  const listing = product.marketplaces.find((l) => l.marketplace === input.marketplace && l.conta_id === input.accountId);
  if (!listing || listing.status !== "publicado") {
    throw new ListingNotPublishedError();
  }

  const db = getDb();
  const account = await marketplaceAccountRepository.findById(db, input.accountId);
  if (!account) throw new MarketplaceAccountNotFoundError();
  if (!account.active) throw new AccountNotReadyError("A conta está desativada — ative-a antes de encerrar o anúncio.");
  if (account.connectionStatus !== "connected") {
    throw new AccountNotReadyError("A conta não está conectada — conecte-a antes de encerrar o anúncio.");
  }

  try {
    await runAccountOperation(input.accountId, ({ account: freshAccount, credential }) =>
      getConnector(input.marketplace).close({ listing, account: toConnectorAccount(freshAccount), credential }),
    );

    await productRepository.upsertMarketplaceListing(db, input.productId, {
      ...listing,
      status: "encerrado",
      encerrado_em: new Date(),
      erro: null,
    });

    await record("PRODUCT_UNPUBLISH", "product", input.productId, input.actingUserId, {
      marketplace: input.marketplace,
      accountId: account.id,
      idAnuncio: listing.id_anuncio,
      success: true,
    });
  } catch (err) {
    if (err instanceof AccountBusyError) throw err;

    const message = err instanceof Error ? err.message : "Falha desconhecida ao encerrar o anúncio.";

    await productRepository.upsertMarketplaceListing(db, input.productId, {
      ...listing,
      erro: `Falha ao encerrar: ${message}`,
    });

    await record("PRODUCT_UNPUBLISH", "product", input.productId, input.actingUserId, {
      marketplace: input.marketplace,
      accountId: account.id,
      idAnuncio: listing.id_anuncio,
      success: false,
      error: message,
    });
  }

  return getProductById(input.productId);
}
