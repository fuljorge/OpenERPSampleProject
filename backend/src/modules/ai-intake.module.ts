import type { FastifyInstance } from "fastify";
import aiIntakeRoutes from "../routes/ai-intake.routes.js";

/** Mesmo prefixo de `product.module.ts` (005) — `/analyze`/`/confirm` não colidem com as
 * rotas de `product.routes.ts` (nenhum POST em `/:id` lá). */
export default async function aiIntakeModule(fastify: FastifyInstance) {
  await fastify.register(aiIntakeRoutes, { prefix: "/api/products" });
}
