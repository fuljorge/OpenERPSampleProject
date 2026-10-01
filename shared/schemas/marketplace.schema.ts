import { z } from "zod";

/**
 * Enum fechado de marketplaces suportados (spec 011, seção 2.1) — mesmo roadmap de
 * implementação da spec (seção 5): Mercado Livre, Shopee, eBay, nesta ordem.
 */
export const MarketplaceEnum = z.enum(["mercado_livre", "shopee", "ebay"]);
export type Marketplace = z.infer<typeof MarketplaceEnum>;

/**
 * `encerrado` (spec 011, seção 4.7): anúncio tirado do ar pelo ERP; o registro da publicação
 * continua no produto. `erro` junto de `publicado` significa "no ar, com pendência" (spec 012, 3.1).
 */
export const MarketplaceListingStatusEnum = z.enum(["nao_publicado", "publicado", "erro", "encerrado"]);

/**
 * Item de `products.marketplaces[]` (spec 011, seção 4.2) — uma publicação por combinação
 * (marketplace, conta). Substitui o antigo objeto fixo `{mercado_livre:{...}, shopee:{...}}`
 * (005/007), que não suportava mais de uma conta por marketplace.
 */
export const MarketplaceListingSchema = z.object({
  marketplace: MarketplaceEnum,
  conta_id: z.string(),
  conta_apelido: z.string(),
  status: MarketplaceListingStatusEnum.default("nao_publicado"),
  id_anuncio: z.string().nullable().default(null),
  url_anuncio: z.string().nullable().default(null),
  publicado_em: z.coerce.date().nullable().default(null),
  // Documentos gravados antes do encerramento existir não têm este campo — daí o default.
  encerrado_em: z.coerce.date().nullable().default(null),
  erro: z.string().nullable().default(null),
});
export type MarketplaceListing = z.infer<typeof MarketplaceListingSchema>;
