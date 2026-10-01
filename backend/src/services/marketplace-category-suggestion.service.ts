import { getDb } from "../database/mongo.client.js";
import { marketplaceAccountRepository } from "../repositories/marketplace-account.repository.js";
import { getProductById } from "./product.service.js";
import { AccountBusyError, runAccountOperation } from "./account-operation.service.js";
import { MarketplaceAccountNotFoundError } from "./marketplace-account.service.js";
import { MarketplaceAccountMismatchError } from "./marketplace-listing.service.js";
import { getCuratedCategories } from "../plugins/marketplaces/mercado-livre-category-catalog.js";
import { suggestCategory as suggestCategoryOnMercadoLivre } from "../plugins/marketplaces/mercado-livre.connector.js";
import type { Marketplace } from "../schemas/marketplace-account.schema.js";

/**
 * Sugestão de categoria para a tela de revisão (spec 012, seção 4; spec 011, seção 4.5; ADR-025).
 * Fora da `MarketplaceConnectorPort` de propósito — é um passo específico do Mercado Livre; hoje
 * é o único marketplace com conector real. Falha do preditor (rede, indisponibilidade) **nunca**
 * bloqueia a revisão: vira `suggested: null`, a lista curada aparece do mesmo jeito.
 */

export interface CategorySuggestionInput {
  productId: string;
  marketplace: Marketplace;
  accountId: string;
}

export interface CategoryOption {
  categoryId: string;
  categoryName: string;
}

export interface CategorySuggestionResult {
  suggested: CategoryOption | null;
  options: CategoryOption[];
}

export class MarketplaceSuggestionUnsupportedError extends Error {
  constructor(marketplace: string) {
    super(`Revisão de categoria não é suportada para ${marketplace}.`);
    this.name = "MarketplaceSuggestionUnsupportedError";
  }
}

export async function suggestCategory(input: CategorySuggestionInput): Promise<CategorySuggestionResult> {
  if (input.marketplace !== "mercado_livre") {
    throw new MarketplaceSuggestionUnsupportedError(input.marketplace);
  }

  const product = await getProductById(input.productId);

  const db = getDb();
  const account = await marketplaceAccountRepository.findById(db, input.accountId);
  if (!account || !account.active) throw new MarketplaceAccountNotFoundError();
  if (account.marketplace !== input.marketplace) throw new MarketplaceAccountMismatchError();

  const options = getCuratedCategories();

  let suggested: CategoryOption | null = null;
  try {
    suggested = await runAccountOperation(input.accountId, ({ credential }) =>
      suggestCategoryOnMercadoLivre(credential, product.identificacao.nome),
    );
  } catch (err) {
    if (err instanceof AccountBusyError || err instanceof MarketplaceAccountNotFoundError) throw err;
    // Qualquer outra falha (rede, token, Mercado Livre fora do ar) não trava a revisão — sem
    // pré-seleção, o operador escolhe manualmente da lista curada (spec 012, seção 4).
    suggested = null;
  }

  return { suggested, options };
}
