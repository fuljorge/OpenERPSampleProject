import type { FastifyInstance } from "fastify";
import { authorize } from "../middleware/authorize.middleware.js";
import { MarketplaceEnum } from "../schemas/marketplace-account.schema.js";
import { z } from "zod";
import { ProductSchema } from "../schemas/product.schema.js";
import { ProductNotFoundError } from "../services/product.service.js";
import { MarketplaceAccountNotFoundError } from "../services/marketplace-account.service.js";
import { AccountBusyError } from "../services/account-operation.service.js";
import {
  AccountNotReadyError,
  ListingNotPublishedError,
  MarketplaceAccountMismatchError,
  ProductMissingRequiredFieldsError,
  closeListing,
  publishListing,
} from "../services/marketplace-listing.service.js";
import {
  MarketplaceSuggestionUnsupportedError,
  suggestCategory,
} from "../services/marketplace-category-suggestion.service.js";
import {
  MarketplaceSizeSuggestionUnsupportedError,
  suggestSize,
} from "../services/marketplace-size-suggestion.service.js";
import {
  MarketplaceShippingSuggestionUnsupportedError,
  suggestShippingOptions,
} from "../services/marketplace-shipping-suggestion.service.js";
import {
  MarketplaceAttributeSuggestionUnsupportedError,
  suggestRequiredAttributes,
} from "../services/marketplace-attribute-suggestion.service.js";
import { CategoryCatalogError } from "../plugins/marketplaces/mercado-livre-category-catalog.js";

const AttributeSuggestionBodySchema = z.object({
  marketplace: MarketplaceEnum,
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
});

const AttributeOptionSchema = z.object({ id: z.string(), name: z.string() });

const PendingAttributeSchema = z.object({
  id: z.string(),
  name: z.string(),
  valueType: z.string().optional(),
  options: z.array(AttributeOptionSchema),
  suggested: AttributeOptionSchema.nullable(),
});

const ShippingChoiceSchema = z.object({
  mode: z.string().min(1),
  logisticType: z.string().min(1),
  freeShipping: z.boolean(),
});

const PublishListingBodySchema = z.object({
  marketplace: MarketplaceEnum,
  accountId: z.string().min(1),
  // Categoria e tipo de anúncio confirmados na tela de revisão (spec 012, seções 3.2 e 4; ADR-025,
  // ADR-026) — opcionais na porta comum (011, seção 4.1); cada conector decide se exige. Ainda sem
  // consumidor real (T023/T025).
  categoryId: z.string().min(1).optional(),
  listingTypeId: z.string().min(1).optional(),
  // Tamanho de calçado escolhido na tela de revisão quando o do cadastro não bate com a tabela
  // do Mercado Livre (spec 012, achado real 24/09/2026) — opcional, só calçado usa.
  sizeOverride: z.string().min(1).optional(),
  // Frete escolhido na tela de revisão (spec 012, achado real 24/09/2026) — opcional.
  shipping: ShippingChoiceSchema.optional(),
  // Obrigatórios da categoria que o cadastro não cobre, escolhidos na revisão (ADR-035).
  extraAttributes: z
    .array(z.object({ id: z.string().min(1), valueId: z.string().min(1).optional(), valueName: z.string().min(1) }))
    .max(50)
    .optional(),
});

const CloseListingBodySchema = z.object({
  marketplace: MarketplaceEnum,
  accountId: z.string().min(1),
});

const CategorySuggestionBodySchema = z.object({
  marketplace: MarketplaceEnum,
  accountId: z.string().min(1),
});

const CategoryOptionSchema = z.object({
  categoryId: z.string().min(1),
  categoryName: z.string().min(1),
});

const CategorySuggestionResponseSchema = z.object({
  suggested: CategoryOptionSchema.nullable(),
  options: z.array(CategoryOptionSchema),
});

const SizeSuggestionBodySchema = z.object({
  marketplace: MarketplaceEnum,
  accountId: z.string().min(1),
  // Depende da categoria já escolhida na revisão — o tamanho é resolvido contra a tabela daquela
  // categoria específica (spec 012, achado real 24/09/2026).
  categoryId: z.string().min(1),
});

const SizeSuggestionResponseSchema = z.object({
  applicable: z.boolean(),
  available: z.array(z.string()),
  current: z.string().nullable(),
  currentMatches: z.boolean(),
  allowCustomSize: z.boolean(),
});

const ShippingSuggestionBodySchema = z.object({
  marketplace: MarketplaceEnum,
  accountId: z.string().min(1),
  // Depende da categoria e do tipo de anúncio já escolhidos na revisão (spec 012, achado real
  // 24/09/2026) — a elegibilidade de frete varia por categoria e tipo de anúncio.
  categoryId: z.string().min(1),
  listingTypeId: z.string().min(1),
});

const ShippingOptionSchema = z.object({
  mode: z.string(),
  logisticType: z.string(),
  isDefault: z.boolean(),
  freeShippingRequired: z.boolean(),
  freeShippingAllowed: z.boolean(),
});

export default async function marketplaceListingRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { id: string } }>(
    "/:id/marketplace-listings",
    { preHandler: [fastify.authenticate, authorize(["admin", "operator"])] },
    async (request, reply) => {
      const parseResult = PublishListingBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ success: false, error: "Dados de publicação inválidos." });
      }

      try {
        const product = await publishListing({
          productId: request.params.id,
          marketplace: parseResult.data.marketplace,
          accountId: parseResult.data.accountId,
          actingUserId: request.user!.id,
          categoryId: parseResult.data.categoryId,
          listingTypeId: parseResult.data.listingTypeId,
          sizeOverride: parseResult.data.sizeOverride,
          shipping: parseResult.data.shipping,
          extraAttributes: parseResult.data.extraAttributes,
        });
        return { success: true, data: ProductSchema.parse(product) };
      } catch (err) {
        if (err instanceof ProductNotFoundError || err instanceof MarketplaceAccountNotFoundError) {
          return reply.code(404).send({ success: false, error: err.message });
        }
        if (err instanceof ProductMissingRequiredFieldsError || err instanceof MarketplaceAccountMismatchError) {
          return reply.code(400).send({ success: false, error: err.message });
        }
        if (err instanceof AccountBusyError) {
          return reply.code(409).send({ success: false, error: err.message });
        }
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/:id/marketplace-listings/close",
    { preHandler: [fastify.authenticate, authorize(["admin", "operator"])] },
    async (request, reply) => {
      const parseResult = CloseListingBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ success: false, error: "Dados de encerramento inválidos." });
      }

      try {
        const product = await closeListing({
          productId: request.params.id,
          marketplace: parseResult.data.marketplace,
          accountId: parseResult.data.accountId,
          actingUserId: request.user!.id,
        });
        return { success: true, data: ProductSchema.parse(product) };
      } catch (err) {
        if (err instanceof ProductNotFoundError || err instanceof MarketplaceAccountNotFoundError) {
          return reply.code(404).send({ success: false, error: err.message });
        }
        if (err instanceof ListingNotPublishedError || err instanceof AccountNotReadyError) {
          return reply.code(409).send({ success: false, error: err.message });
        }
        if (err instanceof AccountBusyError) {
          return reply.code(409).send({ success: false, error: err.message });
        }
        throw err;
      }
    },
  );

  // Sugestão de categoria para a tela de revisão (spec 012, seção 4; spec 011, seção 4.5; ADR-025)
  // — só consulta, nunca cria nem altera nada.
  fastify.post<{ Params: { id: string } }>(
    "/:id/marketplace-category-suggestion",
    { preHandler: [fastify.authenticate, authorize(["admin", "operator"])] },
    async (request, reply) => {
      const parseResult = CategorySuggestionBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ success: false, error: "Dados de sugestão de categoria inválidos." });
      }

      try {
        const result = await suggestCategory({
          productId: request.params.id,
          marketplace: parseResult.data.marketplace,
          accountId: parseResult.data.accountId,
        });
        return { success: true, data: CategorySuggestionResponseSchema.parse(result) };
      } catch (err) {
        if (err instanceof ProductNotFoundError || err instanceof MarketplaceAccountNotFoundError) {
          return reply.code(404).send({ success: false, error: err.message });
        }
        if (err instanceof MarketplaceAccountMismatchError || err instanceof MarketplaceSuggestionUnsupportedError) {
          return reply.code(400).send({ success: false, error: err.message });
        }
        if (err instanceof AccountBusyError) {
          return reply.code(409).send({ success: false, error: err.message });
        }
        if (err instanceof CategoryCatalogError) {
          return reply.code(500).send({ success: false, error: err.message });
        }
        throw err;
      }
    },
  );

  // Sugestão de tamanho pra tela de revisão (spec 012, calçado; ADR-032, roupa) — só consulta.
  // Depende da categoria já escolhida (chamado depois da revisão de categoria, não antes) —
  // diferente da sugestão de categoria, uma falha real aqui não vira "sem sugestão em
  // silêncio": o operador precisa saber que não foi possível checar o tamanho.
  fastify.post<{ Params: { id: string } }>(
    "/:id/marketplace-size-suggestion",
    { preHandler: [fastify.authenticate, authorize(["admin", "operator"])] },
    async (request, reply) => {
      const parseResult = SizeSuggestionBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ success: false, error: "Dados de sugestão de tamanho inválidos." });
      }

      try {
        const result = await suggestSize({
          productId: request.params.id,
          marketplace: parseResult.data.marketplace,
          accountId: parseResult.data.accountId,
          categoryId: parseResult.data.categoryId,
        });
        return { success: true, data: SizeSuggestionResponseSchema.parse(result) };
      } catch (err) {
        if (err instanceof ProductNotFoundError || err instanceof MarketplaceAccountNotFoundError) {
          return reply.code(404).send({ success: false, error: err.message });
        }
        if (err instanceof MarketplaceAccountMismatchError || err instanceof MarketplaceSizeSuggestionUnsupportedError) {
          return reply.code(400).send({ success: false, error: err.message });
        }
        if (err instanceof AccountBusyError) {
          return reply.code(409).send({ success: false, error: err.message });
        }
        throw err;
      }
    },
  );

  // Sugestão de frete pra tela de revisão (spec 012, achado real 24/09/2026) — só consulta.
  // Depende da categoria e do tipo de anúncio já escolhidos; uma falha real aqui não vira "sem
  // sugestão em silêncio", mesmo espírito da sugestão de tamanho.
  fastify.post<{ Params: { id: string } }>(
    "/:id/marketplace-shipping-suggestion",
    { preHandler: [fastify.authenticate, authorize(["admin", "operator"])] },
    async (request, reply) => {
      const parseResult = ShippingSuggestionBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ success: false, error: "Dados de sugestão de frete inválidos." });
      }

      try {
        const result = await suggestShippingOptions({
          productId: request.params.id,
          marketplace: parseResult.data.marketplace,
          accountId: parseResult.data.accountId,
          categoryId: parseResult.data.categoryId,
          listingTypeId: parseResult.data.listingTypeId,
        });
        return { success: true, data: z.array(ShippingOptionSchema).parse(result) };
      } catch (err) {
        if (err instanceof ProductNotFoundError || err instanceof MarketplaceAccountNotFoundError) {
          return reply.code(404).send({ success: false, error: err.message });
        }
        if (err instanceof MarketplaceAccountMismatchError || err instanceof MarketplaceShippingSuggestionUnsupportedError) {
          return reply.code(400).send({ success: false, error: err.message });
        }
        if (err instanceof AccountBusyError) {
          return reply.code(409).send({ success: false, error: err.message });
        }
        throw err;
      }
    },
  );

  // Obrigatórios da categoria que o cadastro não cobre (ADR-035) — só consulta, depende da
  // categoria já escolhida na revisão; a tela mostra uma caixa de seleção para cada um.
  fastify.post<{ Params: { id: string } }>(
    "/:id/marketplace-attribute-suggestion",
    { preHandler: [fastify.authenticate, authorize(["admin", "operator"])] },
    async (request, reply) => {
      const parseResult = AttributeSuggestionBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ success: false, error: "Dados de sugestão de atributos inválidos." });
      }

      try {
        const result = await suggestRequiredAttributes({
          productId: request.params.id,
          marketplace: parseResult.data.marketplace,
          accountId: parseResult.data.accountId,
          categoryId: parseResult.data.categoryId,
        });
        return { success: true, data: z.array(PendingAttributeSchema).parse(result) };
      } catch (err) {
        if (err instanceof ProductNotFoundError || err instanceof MarketplaceAccountNotFoundError) {
          return reply.code(404).send({ success: false, error: err.message });
        }
        if (err instanceof MarketplaceAccountMismatchError || err instanceof MarketplaceAttributeSuggestionUnsupportedError) {
          return reply.code(400).send({ success: false, error: err.message });
        }
        if (err instanceof AccountBusyError) {
          return reply.code(409).send({ success: false, error: err.message });
        }
        throw err;
      }
    },
  );
}
