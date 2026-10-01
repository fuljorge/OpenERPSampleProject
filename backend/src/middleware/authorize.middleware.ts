import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "../repositories/user.repository.js";

/**
 * Factory de guarda por perfil, reutilizável por qualquer módulo (002 em diante). Deve ser
 * composto sempre depois de `fastify.authenticate` na cadeia de `preHandler`:
 * `{ preHandler: [fastify.authenticate, authorize(["admin"])] }` — nunca sozinho, já que
 * depende de `request.user` já estar populado.
 */
export function authorize(roles: UserRole[]) {
  return async function authorizeHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user || !roles.includes(request.user.role)) {
      await reply.code(403).send({ success: false, error: "Acesso negado." });
    }
  };
}
