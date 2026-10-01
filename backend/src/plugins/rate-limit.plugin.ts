import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

/**
 * Limite global "de fundo", sem endurecimento específico ainda — rotas sensíveis (ex.:
 * POST /auth/login) sobrescrevem com um limite mais restrito via `config.rateLimit` na
 * própria definição da rota (ver routes/auth.routes.ts, T013).
 */
export default fp(async function rateLimitPlugin(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });
});
