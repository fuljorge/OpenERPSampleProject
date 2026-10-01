import { z } from "zod";
import { ProductSchema } from "../schemas/product.schema";
import type { Product } from "../schemas/product.schema";
import type { Marketplace } from "../schemas/marketplace-account.schema";

export class ApiError extends Error {}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success) {
    throw new ApiError(body.error ?? "Erro inesperado. Tente novamente.");
  }
  return body.data as T;
}

/** Categoria de revisão do Mercado Livre (spec 012, seção 4; ADR-025). */
const CategoryOptionSchema = z.object({
  categoryId: z.string().min(1),
  categoryName: z.string().min(1),
});
export type CategoryOption = z.infer<typeof CategoryOptionSchema>;

const CategorySuggestionSchema = z.object({
  suggested: CategoryOptionSchema.nullable(),
  options: z.array(CategoryOptionSchema),
});
export type CategorySuggestion = z.infer<typeof CategorySuggestionSchema>;

/** Sugestão de tamanho pra revisão (calçado, spec 012; roupa, ADR-032) — só quando a categoria
 * escolhida usa tabela de medidas (`applicable`). `allowCustomSize`: roupa pode publicar mesmo
 * sem nenhum tamanho em `available` (digitando um), calçado não (ADR-024). */
const MarketplaceSizeSuggestionSchema = z.object({
  applicable: z.boolean(),
  available: z.array(z.string()),
  current: z.string().nullable(),
  currentMatches: z.boolean(),
  allowCustomSize: z.boolean(),
});
export type MarketplaceSizeSuggestion = z.infer<typeof MarketplaceSizeSuggestionSchema>;

/** Opção de frete pra revisão (spec 012, achado real 24/09/2026) — combinação de modo + tipo de
 * logística realmente válida pra esta peça/categoria/tipo de anúncio. */
const ShippingOptionSchema = z.object({
  mode: z.string(),
  logisticType: z.string(),
  isDefault: z.boolean(),
  freeShippingRequired: z.boolean(),
  freeShippingAllowed: z.boolean(),
});
export type ShippingOption = z.infer<typeof ShippingOptionSchema>;

/** Escolha de frete confirmada na revisão — o que de fato viaja no corpo de `publish`. */
export interface ShippingChoice {
  mode: string;
  logisticType: string;
  freeShipping: boolean;
}

const AttributeOptionSchema = z.object({ id: z.string(), name: z.string() });

/** Atributo obrigatório da categoria que o cadastro não cobre (ADR-035) — a revisão pergunta ao
 * operador. `valueType: "list"`: só as opções valem; `"string"`: opções são sugestão, texto livre
 * também vale. */
const PendingAttributeSchema = z.object({
  id: z.string(),
  name: z.string(),
  valueType: z.string().optional(),
  options: z.array(AttributeOptionSchema),
  suggested: AttributeOptionSchema.nullable(),
});
export type PendingAttribute = z.infer<typeof PendingAttributeSchema>;

/** Escolha do operador pra um `PendingAttribute` — o que viaja no corpo de `publish`. */
export interface ExtraAttributeChoice {
  id: string;
  valueId?: string;
  valueName: string;
}

export const marketplaceListingService = {
  async publish(
    productId: string,
    marketplace: Marketplace,
    accountId: string,
    categoryId?: string,
    listingTypeId?: string,
    sizeOverride?: string,
    shipping?: ShippingChoice,
    extraAttributes?: ExtraAttributeChoice[],
  ): Promise<Product> {
    const response = await fetch(`/api/products/${productId}/marketplace-listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        marketplace,
        accountId,
        ...(categoryId ? { categoryId } : {}),
        ...(listingTypeId ? { listingTypeId } : {}),
        ...(sizeOverride ? { sizeOverride } : {}),
        ...(shipping ? { shipping } : {}),
        ...(extraAttributes && extraAttributes.length > 0 ? { extraAttributes } : {}),
      }),
    });
    return ProductSchema.parse(await parseEnvelope<unknown>(response));
  },

  async close(productId: string, marketplace: Marketplace, accountId: string): Promise<Product> {
    const response = await fetch(`/api/products/${productId}/marketplace-listings/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ marketplace, accountId }),
    });
    return ProductSchema.parse(await parseEnvelope<unknown>(response));
  },

  async suggestCategory(productId: string, marketplace: Marketplace, accountId: string): Promise<CategorySuggestion> {
    const response = await fetch(`/api/products/${productId}/marketplace-category-suggestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ marketplace, accountId }),
    });
    return CategorySuggestionSchema.parse(await parseEnvelope<unknown>(response));
  },

  /** Depende da categoria já escolhida/confirmada na revisão (spec 012, achado real 24/09/2026). */
  async suggestSize(productId: string, marketplace: Marketplace, accountId: string, categoryId: string): Promise<MarketplaceSizeSuggestion> {
    const response = await fetch(`/api/products/${productId}/marketplace-size-suggestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ marketplace, accountId, categoryId }),
    });
    return MarketplaceSizeSuggestionSchema.parse(await parseEnvelope<unknown>(response));
  },

  /** Depende da categoria e do tipo de anúncio já escolhidos na revisão (spec 012, achado real 24/09/2026). */
  async suggestShipping(
    productId: string,
    marketplace: Marketplace,
    accountId: string,
    categoryId: string,
    listingTypeId: string,
  ): Promise<ShippingOption[]> {
    const response = await fetch(`/api/products/${productId}/marketplace-shipping-suggestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ marketplace, accountId, categoryId, listingTypeId }),
    });
    return z.array(ShippingOptionSchema).parse(await parseEnvelope<unknown>(response));
  },

  /** Obrigatórios da categoria que o cadastro não cobre (ADR-035) — depende da categoria já escolhida. */
  async suggestAttributes(productId: string, marketplace: Marketplace, accountId: string, categoryId: string): Promise<PendingAttribute[]> {
    const response = await fetch(`/api/products/${productId}/marketplace-attribute-suggestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ marketplace, accountId, categoryId }),
    });
    return z.array(PendingAttributeSchema).parse(await parseEnvelope<unknown>(response));
  },
};
