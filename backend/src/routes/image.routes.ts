import type { FastifyInstance } from "fastify";
import { authorize } from "../middleware/authorize.middleware.js";
import { UploadedImageSchema } from "../schemas/image.schema.js";
import { ImageTooLargeError, InvalidImageTypeError, removeImage, uploadImage } from "../services/image.service.js";

/**
 * Upload/remoção de fotos de produto (spec 007) — usado tanto pelo cadastro manual (005)
 * quanto pelo cadastro assistido por IA (006). Nenhuma collection própria de imagens: o
 * cliente embute o metadado retornado aqui em `products.imagens` via `POST`/`PATCH /products`.
 */
export default async function imageRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: [fastify.authenticate, authorize(["admin", "operator"])] };

  fastify.post("/", guard, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ success: false, error: "Nenhum arquivo enviado." });
    }

    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      return reply.code(400).send({ success: false, error: "Arquivo maior que o limite permitido." });
    }

    try {
      const uploaded = await uploadImage({ buffer, mimeType: file.mimetype });
      return reply.code(201).send({ success: true, data: UploadedImageSchema.parse(uploaded) });
    } catch (err) {
      if (err instanceof InvalidImageTypeError || err instanceof ImageTooLargeError) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: string } }>("/:id", guard, async (request) => {
    await removeImage(request.params.id);
    return { success: true };
  });
}
