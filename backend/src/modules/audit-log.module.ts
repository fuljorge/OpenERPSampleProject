import type { FastifyInstance } from "fastify";
import auditLogRoutes from "../routes/audit-log.routes.js";

export default async function auditLogModule(fastify: FastifyInstance) {
  await fastify.register(auditLogRoutes, { prefix: "/api/audit-logs" });
}
