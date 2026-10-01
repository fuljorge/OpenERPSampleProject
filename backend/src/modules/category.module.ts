import type { FastifyInstance } from "fastify";
import categoryRoutes from "../routes/category.routes.js";

export default async function categoryModule(fastify: FastifyInstance) {
  await fastify.register(categoryRoutes, { prefix: "/api/categories" });
}
