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

export interface ListProductsParams {
  search?: string;
  categoria_codigo?: string;
  status?: string;
  tamanho?: string;
  cor?: string;
  estado?: string;
  preco_min?: string;
  preco_max?: string;
  page?: number;
  limit?: number;
}

export interface ListProductsResult {
  items: Product[];
  total: number;
  page: number;
  limit: number;
}

function buildQuery(params: ListProductsParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

export const productService = {
  async list(params: ListProductsParams): Promise<ListProductsResult> {
    const response = await fetch(`/api/products${buildQuery(params)}`, { credentials: "include" });
    const data = await parseEnvelope<{ items: unknown[]; total: number; page: number; limit: number }>(response);
    return { ...data, items: data.items.map((item) => ProductSchema.parse(item)) };
  },

  async getById(id: string): Promise<Product> {
    const response = await fetch(`/api/products/${id}`, { credentials: "include" });
    return ProductSchema.parse(await parseEnvelope<unknown>(response));
  },

  async create(payload: unknown): Promise<Product> {
    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return ProductSchema.parse(await parseEnvelope<unknown>(response));
  },

  async update(id: string, payload: unknown): Promise<Product> {
    const response = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return ProductSchema.parse(await parseEnvelope<unknown>(response));
  },

  async softDelete(id: string): Promise<void> {
    const response = await fetch(`/api/products/${id}`, { method: "DELETE", credentials: "include" });
    await parseEnvelope<null>(response);
  },
};
