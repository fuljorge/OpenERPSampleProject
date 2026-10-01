import { z } from "zod";

/**
 * Constantes de validação de upload (spec 007, seção 4) — não fixadas pela spec, definidas
 * na implementação. `MAX_PRODUCT_IMAGES` (limite por peça) vive no schema compartilhado do
 * produto (fonte única), não aqui.
 */
export const ALLOWED_IMAGE_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const UploadedImageSchema = z.object({
  id: z.string(),
  url: z.string(),
});
export type UploadedImageResponse = z.infer<typeof UploadedImageSchema>;
