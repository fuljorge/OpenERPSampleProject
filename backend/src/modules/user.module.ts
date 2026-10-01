import type { FastifyInstance } from "fastify";
import userRoutes from "../routes/user.routes.js";

export default async function userModule(fastify: FastifyInstance) {
  await fastify.register(userRoutes, { prefix: "/api/users" });
}
