import cors from "@fastify/cors";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

/**
 * CORS restritivo (constituição, princípio VII): só a origem do frontend configurada é
 * liberada, com `credentials: true` para permitir o envio dos cookies de sessão em chamadas
 * cross-origin (necessário sempre que o frontend não estiver atrás do proxy de dev do Vite,
 * ex.: produção). Sem `FRONTEND_URL`, nenhuma origem é liberada.
 */
export default fp(async function corsPlugin(fastify: FastifyInstance) {
  const frontendUrl = process.env.FRONTEND_URL;

  await fastify.register(cors, {
    origin: frontendUrl ? [frontendUrl] : false,
    credentials: true,
  });
});
