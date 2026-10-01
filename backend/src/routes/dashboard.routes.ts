import type { FastifyInstance } from "fastify";
import { getSummary } from "../services/dashboard.service.js";

/** Qualquer perfil autenticado (spec 009, plan.md seção 5, passo 2) — os números agregados
 * não expõem dado individual sensível, então não há restrição adicional de `role`. */
export default async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get("/summary", { preHandler: [fastify.authenticate] }, async () => {
    return { success: true, data: await getSummary() };
  });
}
