import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `frontend/dist` é irmão de `backend/` e `shared/` na raiz do monorepo (mesmo padrão já usado
 * pelo import relativo de `shared/dist` em multipart.plugin.ts) — no container, a imagem
 * preserva essa mesma estrutura de diretórios (spec 010, seção 4).
 */
export const FRONTEND_DIST_PATH = path.resolve(here, "../../../frontend/dist");

/**
 * Serve o build estático do frontend no mesmo processo/porta do backend (spec 010) — elimina a
 * origem cruzada entre frontend e backend em produção. Só registra se o diretório existir:
 * em `npm run dev` local ele nunca existe (o Vite serve o frontend separadamente), então este
 * plugin não tem nenhum efeito no fluxo de desenvolvimento de hoje.
 */
export default fp(async function staticPlugin(fastify: FastifyInstance) {
  if (!fs.existsSync(FRONTEND_DIST_PATH)) return;

  await fastify.register(fastifyStatic, {
    root: FRONTEND_DIST_PATH,
  });

  fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    if (request.method !== "GET" || request.url.startsWith("/api/")) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    reply.sendFile("index.html");
  });
});
