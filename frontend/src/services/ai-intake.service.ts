import { AiSuggestedProductSchema, type AiSuggestedProduct } from "../schemas/ai-intake.schema";
import { ProductSchema, type Product } from "../schemas/product.schema";

export class ApiError extends Error {}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success) {
    throw new ApiError(body.error ?? "Erro inesperado. Tente novamente.");
  }
  return body.data as T;
}

export const aiIntakeService = {
  async analyze(prompt: string, images: File[]): Promise<AiSuggestedProduct> {
    const formData = new FormData();
    formData.append("prompt", prompt);
    for (const image of images) {
      formData.append("images[]", image, image.name);
    }

    const response = await fetch("/api/products/analyze", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    return AiSuggestedProductSchema.parse(await parseEnvelope<unknown>(response));
  },

  /** Reavaliação de produto já cadastrado (spec 006, seção 9) — usa as fotos já salvas na
   * galeria do produto, sem reenviar nada. */
  async reanalyze(productId: string): Promise<AiSuggestedProduct> {
    const response = await fetch(`/api/products/${productId}/reanalyze`, {
      method: "POST",
      credentials: "include",
    });
    return AiSuggestedProductSchema.parse(await parseEnvelope<unknown>(response));
  },

  async confirm(payload: unknown): Promise<Product> {
    const response = await fetch("/api/products/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return ProductSchema.parse(await parseEnvelope<unknown>(response));
  },
};
