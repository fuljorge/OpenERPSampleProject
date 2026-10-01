import { getDb } from "../database/mongo.client.js";
import { marketplaceAccountRepository } from "../repositories/marketplace-account.repository.js";
import { getProductById } from "./product.service.js";
import { runAccountOperation } from "./account-operation.service.js";
import { MarketplaceAccountNotFoundError } from "./marketplace-account.service.js";
import { MarketplaceAccountMismatchError } from "./marketplace-listing.service.js";
import { suggestShipping, type ShippingSuggestionOption } from "../plugins/marketplaces/mercado-livre.connector.js";
import type { Marketplace } from "../schemas/marketplace-account.schema.js";

/**
 * Sugestão de frete pra tela de revisão (spec 012, achado real 24/09/2026) — mesmo espírito de
 * `marketplace-size-suggestion.service.ts`: depende da categoria e do tipo de anúncio já
 * escolhidos, chamado depois que o operador confirmou os dois. Uma falha real (rede, token,
 * Mercado Livre fora do ar) propaga — não é uma previsão dispensável.
 */

export interface ShippingSuggestionInput {
  productId: string;
  marketplace: Marketplace;
  accountId: string;
  categoryId: string;
  listingTypeId: string;
}

export class MarketplaceShippingSuggestionUnsupportedError extends Error {
  constructor(marketplace: string) {
    super(`Sugestão de frete não é suportada para ${marketplace}.`);
    this.name = "MarketplaceShippingSuggestionUnsupportedError";
  }
}

export async function suggestShippingOptions(input: ShippingSuggestionInput): Promise<ShippingSuggestionOption[]> {
  if (input.marketplace !== "mercado_livre") {
    throw new MarketplaceShippingSuggestionUnsupportedError(input.marketplace);
  }

  const product = await getProductById(input.productId);

  const db = getDb();
  const account = await marketplaceAccountRepository.findById(db, input.accountId);
  if (!account || !account.active) throw new MarketplaceAccountNotFoundError();
  if (account.marketplace !== input.marketplace) throw new MarketplaceAccountMismatchError();

  return runAccountOperation(input.accountId, ({ credential }) =>
    suggestShipping(credential, product, input.categoryId, input.listingTypeId),
  );
}
