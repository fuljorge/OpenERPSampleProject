import Fastify, { type FastifyInstance } from "fastify";
import authenticateMiddleware from "./middleware/authenticate.middleware.js";
import aiIntakeModule from "./modules/ai-intake.module.js";
import aiSettingsModule from "./modules/ai-settings.module.js";
import auditLogModule from "./modules/audit-log.module.js";
import authModule from "./modules/auth.module.js";
import categoryModule from "./modules/category.module.js";
import dashboardModule from "./modules/dashboard.module.js";
import imageModule from "./modules/image.module.js";
import marketplaceModule from "./modules/marketplace.module.js";
import productModule from "./modules/product.module.js";
import userModule from "./modules/user.module.js";
import cookiePlugin from "./plugins/cookie.plugin.js";
import corsPlugin from "./plugins/cors.plugin.js";
import multipartPlugin from "./plugins/multipart.plugin.js";
import rateLimitPlugin from "./plugins/rate-limit.plugin.js";
import staticPlugin from "./plugins/static.plugin.js";
import { MAX_IMAGE_SIZE_BYTES } from "./schemas/image.schema.js";
import { MAX_PRODUCT_IMAGES } from "../../shared/dist/schemas/product.schema.js";

export interface BuildAppOptions {
  logger?: boolean;
}

/**
 * `bodyLimit` do Fastify (corpo da requisição inteira) é **separado** do `limits.fileSize` do
 * `@fastify/multipart` (por arquivo) — o default do Fastify é 1 MB, bem abaixo do
 * `MAX_IMAGE_SIZE_BYTES` (5 MB) já configurado no multipart. Sem isso, qualquer foto de
 * celular acima de ~1 MB (a maioria) era rejeitada com 413 "Payload Too Large" antes mesmo de
 * chegar na validação de tamanho/MIME do próprio app — bug real relatado pelo usuário. Pior
 * caso: `POST /products/analyze` (006) envia várias fotos numa única requisição, até
 * `MAX_PRODUCT_IMAGES` de uma vez.
 */
const MAX_REQUEST_BODY_BYTES = MAX_IMAGE_SIZE_BYTES * MAX_PRODUCT_IMAGES;

/**
 * Monta a instância Fastify (plugins + rotas), sem conectar ao MongoDB nem abrir porta —
 * separado de `server.ts` para permitir testes de integração via `app.inject()`.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: MAX_REQUEST_BODY_BYTES });

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(corsPlugin);
  await app.register(cookiePlugin);
  await app.register(rateLimitPlugin);
  await app.register(multipartPlugin);
  await app.register(authenticateMiddleware);
  await app.register(authModule);
  await app.register(userModule);
  await app.register(auditLogModule);
  await app.register(categoryModule);
  await app.register(productModule);
  await app.register(marketplaceModule);
  await app.register(imageModule);
  await app.register(aiIntakeModule);
  await app.register(aiSettingsModule);
  await app.register(dashboardModule);

  // Depois de todas as rotas /api/*: o fallback SPA (spec 010) não pode interceptar a API.
  await app.register(staticPlugin);

  return app;
}
