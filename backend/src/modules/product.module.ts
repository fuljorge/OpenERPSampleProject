import type { FastifyInstance } from "fastify";
import productRoutes from "../routes/product.routes.js";

export default async function productModule(fastify: FastifyInstance) {
  await fastify.register(productRoutes, { prefix: "/api/products" });
}
