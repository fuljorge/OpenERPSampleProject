import type { DownloadedImage, ImageProviderPort, UploadedImage } from "../plugins/images/image-provider.port.js";
import { AzureBlobImageProvider } from "../plugins/images/azure-blob.adapter.js";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_SIZE_BYTES } from "../schemas/image.schema.js";

export class InvalidImageTypeError extends Error {
  constructor(mimeType: string) {
    super(`Tipo de arquivo não permitido: "${mimeType}". Envie JPEG, PNG ou WebP.`);
    this.name = "InvalidImageTypeError";
  }
}

export class ImageTooLargeError extends Error {
  constructor() {
    super(`Arquivo maior que o limite permitido (${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)}MB).`);
    this.name = "ImageTooLargeError";
  }
}

let provider: ImageProviderPort | undefined;

/** Instanciado sob demanda (nunca no import do módulo) — mantém testes que não usam upload de
 * imagem livres de exigir as env vars do Azure Blob Storage. */
function getProvider(): ImageProviderPort {
  provider ??= new AzureBlobImageProvider();
  return provider;
}

/** Seam de teste — injeta um provider fake (ex.: adapter Azure mockado) sem tocar env vars. */
export function setImageProviderForTesting(fake: ImageProviderPort): void {
  provider = fake;
}

export interface UploadImageInput {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Valida MIME type e tamanho antes de qualquer upload — extraída para ser reaproveitada por
 * `ai-intake.service.ts` (006), que precisa da mesma validação para as fotos enviadas a
 * `/products/analyze` sem fazer upload delas para o Azure Blob Storage (a análise é
 * transiente; só as fotos que o operador confirma no formulário viram upload real, via
 * `ImageUploader`/`POST /images`).
 */
export function assertValidImage(mimeType: string, byteLength: number): string {
  const extension = ALLOWED_IMAGE_MIME_TYPES[mimeType];
  if (!extension) {
    throw new InvalidImageTypeError(mimeType);
  }
  if (byteLength > MAX_IMAGE_SIZE_BYTES) {
    throw new ImageTooLargeError();
  }
  return extension;
}

export async function uploadImage(input: UploadImageInput): Promise<UploadedImage> {
  const extension = assertValidImage(input.mimeType, input.buffer.byteLength);
  return getProvider().upload(input.buffer, input.mimeType, extension);
}

export async function removeImage(id: string): Promise<void> {
  await getProvider().remove(id);
}

/** Usado pela reavaliação por IA de um produto já cadastrado (006, spec seção 9) — busca uma
 * foto já enviada, pelo mesmo `id` persistido em `products.imagens.galeria`. */
export async function downloadImage(id: string): Promise<DownloadedImage> {
  return getProvider().download(id);
}
