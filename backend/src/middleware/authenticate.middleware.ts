import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ACCESS_COOKIE_NAME, verifyAccessToken, type AuthenticatedUser } from "../services/auth.service.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Decora `fastify.authenticate` como `preHandler` reutilizável por qualquer rota protegida
 * (001 a 009) — lê o access token do cookie, valida via `verifyAccessToken` e popula
 * `request.user`. Rotas que exigem um perfil específico (`authorize(["admin"])`) compõem esse
 * preHandler com uma checagem adicional, implementada em 002-usuarios.
 */
export default fp(async function authenticateMiddleware(fastify: FastifyInstance) {
  fastify.decorate("authenticate", async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies[ACCESS_COOKIE_NAME];
    if (!token) {
      return reply.code(401).send({ success: false, error: "Não autenticado." });
    }

    try {
      request.user = verifyAccessToken(token);
    } catch {
      return reply.code(401).send({ success: false, error: "Sessão inválida ou expirada." });
    }
  });
});
