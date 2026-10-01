import type { FastifyInstance } from "fastify";
import aiSettingsRoutes from "../routes/ai-settings.routes.js";

export default async function aiSettingsModule(fastify: FastifyInstance) {
  await fastify.register(aiSettingsRoutes, { prefix: "/api/settings" });
}
