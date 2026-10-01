import { randomUUID } from "node:crypto";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import type { DownloadedImage, ImageProviderPort, UploadedImage } from "./image-provider.port.js";

/**
 * Adapter concreto do `ImageProviderPort` para Azure Blob Storage (ADR-001/ADR-003).
 * Container configurado com leitura pública a nível de blob — a URL retornada no upload é
 * estável e persistida diretamente em `products.imagens.*.url`, sem SAS token.
 */

export interface AzureBlobAdapterConfig {
  connectionString?: string;
  containerName?: string;
}

export class AzureBlobImageProvider implements ImageProviderPort {
  private readonly containerClient: ContainerClient;

  constructor(config: AzureBlobAdapterConfig = {}) {
    const connectionString = config.connectionString ?? process.env.AZURE_STORAGE_CONNECTION_STRING;
    const containerName = config.containerName ?? process.env.AZURE_STORAGE_CONTAINER_NAME;

    if (!connectionString) {
      throw new Error("AZURE_STORAGE_CONNECTION_STRING não configurada — necessária para upload de imagens.");
    }
    if (!containerName) {
      throw new Error("AZURE_STORAGE_CONTAINER_NAME não configurado — necessário para upload de imagens.");
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    this.containerClient = blobServiceClient.getContainerClient(containerName);
  }

  async upload(buffer: Buffer, mimeType: string, extension: string): Promise<UploadedImage> {
    const id = `${randomUUID()}.${extension}`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(id);
    await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType } });
    return { id, url: blockBlobClient.url };
  }

  async remove(id: string): Promise<void> {
    await this.containerClient.getBlockBlobClient(id).deleteIfExists();
  }

  async download(id: string): Promise<DownloadedImage> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(id);
    // `contentType` não é persistido em `products.imagens` (005, seção 2) — só o Azure sabe o
    // MIME type gravado no upload (`blobHTTPHeaders.blobContentType`), daí a segunda chamada.
    const [buffer, properties] = await Promise.all([blockBlobClient.downloadToBuffer(), blockBlobClient.getProperties()]);
    return { buffer, mimeType: properties.contentType ?? "application/octet-stream" };
  }
}
