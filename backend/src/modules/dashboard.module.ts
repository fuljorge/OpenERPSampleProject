import type { FastifyInstance } from "fastify";
import dashboardRoutes from "../routes/dashboard.routes.js";

export default async function dashboardModule(fastify: FastifyInstance) {
  await fastify.register(dashboardRoutes, { prefix: "/api/dashboard" });
}
