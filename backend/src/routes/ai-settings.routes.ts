import type { FastifyInstance } from "fastify";
import { authorize } from "../middleware/authorize.middleware.js";
import { AiSettingsInputSchema } from "../../../shared/dist/schemas/ai-settings.schema.js";
import { AiSettingsIncompleteError, getAiSettingsForDisplay, updateAiSettings } from "../services/ai-settings.service.js";

export default async function aiSettingsRoutes(fastify: FastifyInstance) {
  // Mesma exceção de contas de marketplace (spec 011, seção 2.2): até a leitura é restrita a
  // admin — configuração de um provedor externo que recebe fotos/descrições de peças não é
  // operação de `operator` (spec 013, seção 4).
  const adminGuard = { preHandler: [fastify.authenticate, authorize(["admin"])] };

  fastify.get("/ai", adminGuard, async () => {
    const settings = await getAiSettingsForDisplay();
    return { success: true, data: settings };
  });

  fastify.patch("/ai", adminGuard, async (request, reply) => {
    const parseResult = AiSettingsInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dados de configuração inválidos." });
    }

    try {
      const settings = await updateAiSettings(parseResult.data, request.user!.id);
      return { success: true, data: settings };
    } catch (err) {
      if (err instanceof AiSettingsIncompleteError) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });
}
