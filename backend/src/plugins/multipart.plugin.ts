import multipart from "@fastify/multipart";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { MAX_IMAGE_SIZE_BYTES } from "../schemas/image.schema.js";
import { MAX_PRODUCT_IMAGES } from "../../../shared/dist/schemas/product.schema.js";

/**
 * `files: MAX_PRODUCT_IMAGES` — precisa cobrir tanto `POST /images` (007, sempre 1 arquivo
 * por requisição) quanto `POST /products/analyze` (006, várias fotos numa única requisição
 * multipart). Config é global (um único registro do plugin); a rota de 007 só consome o
 * primeiro part de qualquer forma (`request.file()`), então o teto mais alto não muda seu
 * comportamento.
 */
export default fp(async function multipartPlugin(fastify: FastifyInstance) {
  await fastify.register(multipart, {
    limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: MAX_PRODUCT_IMAGES },
  });
});
