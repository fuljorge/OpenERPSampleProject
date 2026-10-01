/**
 * Porta de abstração do provedor de armazenamento de imagens (constituição, princípio VI).
 * Nenhuma camada de domínio ou serviço deve conhecer o SDK/API de um provedor concreto —
 * apenas este contrato. Validação de MIME type/tamanho/quantidade acontece em
 * `services/image.service.ts`, nunca aqui: o adapter só fala com o provedor.
 */

export interface UploadedImage {
  /** Também usado como identificador de remoção (`DELETE /api/images/:id`) — nenhuma
   * collection própria de imagens existe no MongoDB; o único registro persistido é o que o
   * cliente embute em `products.imagens` após o upload (spec 007, seção 2). */
  id: string;
  url: string;
}

export interface DownloadedImage {
  buffer: Buffer;
  mimeType: string;
}

export interface ImageProviderPort {
  upload(buffer: Buffer, mimeType: string, extension: string): Promise<UploadedImage>;
  remove(id: string): Promise<void>;
  /** Recupera os bytes + MIME type de uma imagem já enviada, a partir do mesmo `id` retornado
   * por `upload` (spec 006, seção 9 — reavaliação por IA de um produto já cadastrado busca as
   * fotos já salvas em vez de receber upload novo). `products.imagens.galeria[]` não persiste
   * MIME type (005, seção 2), então o adapter precisa recuperá-lo do próprio provedor. */
  download(id: string): Promise<DownloadedImage>;
}
