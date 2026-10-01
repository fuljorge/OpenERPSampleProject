import { getDb } from "../database/mongo.client.js";
import { marketplaceAccountRepository } from "../repositories/marketplace-account.repository.js";
import { getProductById } from "./product.service.js";
import { runAccountOperation } from "./account-operation.service.js";
import { MarketplaceAccountNotFoundError } from "./marketplace-account.service.js";
import { MarketplaceAccountMismatchError } from "./marketplace-listing.service.js";
import { suggestSizes, type MarketplaceSizeSuggestion } from "../plugins/marketplaces/mercado-livre.connector.js";
import type { Marketplace } from "../schemas/marketplace-account.schema.js";

/**
 * Sugestão de tamanho (calçado, spec 012; roupa, ADR-032) pra tela de revisão — mesmo espírito
 * de `marketplace-category-suggestion.service.ts`, mas **depende** da categoria já escolhida (o
 * tamanho é resolvido contra as tabelas daquela categoria específica), então o operador chama
 * isto depois de escolher/confirmar a categoria, não antes.
 *
 * Diferente da sugestão de categoria (preditor, best-effort, `suggested: null` em qualquer
 * falha): aqui uma falha real (rede, token, Mercado Livre fora do ar) propaga — não é uma
 * previsão dispensável, é o dado que decide se a publicação vai falhar ou não; esconder o erro
 * deixaria o operador achando que o tamanho bate quando na verdade não foi possível checar.
 */

export interface SizeSuggestionInput {
  productId: string;
  marketplace: Marketplace;
  accountId: string;
  categoryId: string;
}

export class MarketplaceSizeSuggestionUnsupportedError extends Error {
  constructor(marketplace: string) {
    super(`Sugestão de tamanho não é suportada para ${marketplace}.`);
    this.name = "MarketplaceSizeSuggestionUnsupportedError";
  }
}

export async function suggestSize(input: SizeSuggestionInput): Promise<MarketplaceSizeSuggestion> {
  if (input.marketplace !== "mercado_livre") {
    throw new MarketplaceSizeSuggestionUnsupportedError(input.marketplace);
  }

  const product = await getProductById(input.productId);

  const db = getDb();
  const account = await marketplaceAccountRepository.findById(db, input.accountId);
  if (!account || !account.active) throw new MarketplaceAccountNotFoundError();
  if (account.marketplace !== input.marketplace) throw new MarketplaceAccountMismatchError();

  return runAccountOperation(input.accountId, ({ credential }) => suggestSizes(credential, product, input.categoryId));
}
