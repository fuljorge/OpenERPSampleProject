import type { FastifyInstance } from "fastify";
import { authorize } from "../middleware/authorize.middleware.js";
import {
  CreateProductSchema,
  ListProductsQuerySchema,
  ProductSchema,
  UpdateProductSchema,
} from "../schemas/product.schema.js";
import {
  InvalidStatusTransitionError,
  ProductNotFoundError,
  createProduct,
  getProductById,
  listProducts,
  softDeleteProduct,
  updateProduct,
} from "../services/product.service.js";
import { InvalidCategoryError } from "../services/category.service.js";

export default async function productRoutes(fastify: FastifyInstance) {
  // Consulta (GET) é liberada a qualquer perfil autenticado — inclusive `viewer` (spec 002:
  // "consultar produtos, catálogo e estoque"). Mutações exigem admin+operator (ou só admin
  // no DELETE — ver tasks.md, correção da divergência do plan.md).
  const readGuard = { preHandler: [fastify.authenticate] };
  const writeGuard = { preHandler: [fastify.authenticate, authorize(["admin", "operator"])] };
  const deleteGuard = { preHandler: [fastify.authenticate, authorize(["admin"])] };

  fastify.get("/", readGuard, async (request, reply) => {
    const parseResult = ListProductsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Parâmetros de busca inválidos." });
    }

    const result = await listProducts(parseResult.data);
    return {
      success: true,
      data: {
        ...result,
        items: result.items.map((product) => ProductSchema.parse(product)),
      },
    };
  });

  fastify.get<{ Params: { id: string } }>("/:id", readGuard, async (request, reply) => {
    try {
      const product = await getProductById(request.params.id);
      return { success: true, data: ProductSchema.parse(product) };
    } catch (err) {
      if (err instanceof ProductNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.post("/", writeGuard, async (request, reply) => {
    const parseResult = CreateProductSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dados de produto inválidos." });
    }

    try {
      const product = await createProduct({ ...parseResult.data, actingUserId: request.user!.id });
      return reply.code(201).send({ success: true, data: ProductSchema.parse(product) });
    } catch (err) {
      if (err instanceof InvalidCategoryError) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: string } }>("/:id", writeGuard, async (request, reply) => {
    const parseResult = UpdateProductSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dados de atualização inválidos." });
    }

    try {
      const product = await updateProduct(request.params.id, parseResult.data, request.user!.id);
      return { success: true, data: ProductSchema.parse(product) };
    } catch (err) {
      if (err instanceof ProductNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      if (err instanceof InvalidStatusTransitionError || err instanceof InvalidCategoryError) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: string } }>("/:id", deleteGuard, async (request, reply) => {
    try {
      await softDeleteProduct(request.params.id, request.user!.id);
      return { success: true };
    } catch (err) {
      if (err instanceof ProductNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });
}
