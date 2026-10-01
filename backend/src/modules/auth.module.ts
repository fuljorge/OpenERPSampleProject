import type { FastifyInstance } from "fastify";
import authRoutes from "../routes/auth.routes.js";

export default async function authModule(fastify: FastifyInstance) {
  await fastify.register(authRoutes, { prefix: "/api/auth" });
}
