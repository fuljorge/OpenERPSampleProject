import type { FastifyInstance } from "fastify";
import { authorize } from "../middleware/authorize.middleware.js";
import {
  CategorySchema,
  CreateCategorySchema,
  ListCategoriesQuerySchema,
  UpdateCategorySchema,
  UpdateCategoryStatusSchema,
} from "../schemas/category.schema.js";
import {
  CategoryCodeAlreadyExistsError,
  CategoryNotFoundError,
  createCategory,
  listCategories,
  updateCategoryProfile,
  updateCategoryStatus,
} from "../services/category.service.js";

export default async function categoryRoutes(fastify: FastifyInstance) {
  // GET é liberado a qualquer perfil autenticado (spec 003: taxonomia é consultada por
  // todos); POST/PATCH restritos a admin (administração de categorias).
  const adminGuard = { preHandler: [fastify.authenticate, authorize(["admin"])] };

  fastify.get("/", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parseResult = ListCategoriesQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Parâmetros de busca inválidos." });
    }

    const categories = await listCategories(parseResult.data.active);
    return { success: true, data: categories.map((category) => CategorySchema.parse(category)) };
  });

  fastify.post("/", adminGuard, async (request, reply) => {
    const parseResult = CreateCategorySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dados de categoria inválidos." });
    }

    try {
      const category = await createCategory({ ...parseResult.data, actingAdminId: request.user!.id });
      return reply.code(201).send({ success: true, data: CategorySchema.parse(category) });
    } catch (err) {
      if (err instanceof CategoryCodeAlreadyExistsError) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: string } }>("/:id", adminGuard, async (request, reply) => {
    const parseResult = UpdateCategorySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dados de atualização inválidos." });
    }

    try {
      const category = await updateCategoryProfile(request.params.id, parseResult.data, request.user!.id);
      return { success: true, data: CategorySchema.parse(category) };
    } catch (err) {
      if (err instanceof CategoryNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: string } }>("/:id/status", adminGuard, async (request, reply) => {
    const parseResult = UpdateCategoryStatusSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Status inválido." });
    }

    try {
      const category = await updateCategoryStatus(
        request.params.id,
        parseResult.data.active,
        request.user!.id,
      );
      return { success: true, data: CategorySchema.parse(category) };
    } catch (err) {
      if (err instanceof CategoryNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });
}
