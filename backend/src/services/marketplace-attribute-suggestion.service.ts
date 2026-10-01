import { getDb } from "../database/mongo.client.js";
import { marketplaceAccountRepository } from "../repositories/marketplace-account.repository.js";
import { getProductById } from "./product.service.js";
import { runAccountOperation } from "./account-operation.service.js";
import { MarketplaceAccountNotFoundError } from "./marketplace-account.service.js";
import { MarketplaceAccountMismatchError } from "./marketplace-listing.service.js";
import { suggestAttributes, type PendingRequiredAttribute } from "../plugins/marketplaces/mercado-livre.connector.js";
import type { Marketplace } from "../schemas/marketplace-account.schema.js";

/**
 * Atributos obrigatórios da categoria que o cadastro não cobre (ADR-035) — pra tela de revisão
 * mostrar caixas de seleção antes de publicar. Mesmo espírito de
 * `marketplace-size-suggestion.service.ts`: depende da categoria já escolhida, e uma falha real
 * propaga — sem essa lista, a publicação falharia de qualquer forma.
 */

export interface AttributeSuggestionInput {
  productId: string;
  marketplace: Marketplace;
  accountId: string;
  categoryId: string;
}

export class MarketplaceAttributeSuggestionUnsupportedError extends Error {
  constructor(marketplace: string) {
    super(`Sugestão de atributos não é suportada para ${marketplace}.`);
    this.name = "MarketplaceAttributeSuggestionUnsupportedError";
  }
}

export async function suggestRequiredAttributes(input: AttributeSuggestionInput): Promise<PendingRequiredAttribute[]> {
  if (input.marketplace !== "mercado_livre") {
    throw new MarketplaceAttributeSuggestionUnsupportedError(input.marketplace);
  }

  const product = await getProductById(input.productId);

  const db = getDb();
  const account = await marketplaceAccountRepository.findById(db, input.accountId);
  if (!account || !account.active) throw new MarketplaceAccountNotFoundError();
  if (account.marketplace !== input.marketplace) throw new MarketplaceAccountMismatchError();

  return runAccountOperation(input.accountId, ({ credential }) => suggestAttributes(credential, product, input.categoryId));
}
