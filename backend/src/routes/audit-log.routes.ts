import type { FastifyInstance } from "fastify";
import { authorize } from "../middleware/authorize.middleware.js";
import { AuditLogListResultSchema, AuditLogQuerySchema } from "../schemas/audit-log.schema.js";
import { list } from "../services/audit-log.service.js";

export default async function auditLogRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/",
    { preHandler: [fastify.authenticate, authorize(["admin"])] },
    async (request, reply) => {
      const parseResult = AuditLogQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.code(400).send({ success: false, error: "Parâmetros de busca inválidos." });
      }

      const result = await list(parseResult.data);
      // .parse (não safeParse): se um registro divergir do contrato aqui, é um bug real que
      // deve estourar alto, não passar batido como um 200 com formato errado (mesmo padrão de
      // GET /me em auth.routes.ts).
      return { success: true, data: AuditLogListResultSchema.parse(result) };
    },
  );
}
