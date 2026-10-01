import { CategorySchema, type Category, type CreateCategoryFormValues, type EditCategoryFormValues } from "../schemas/category.schema";

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

export const categoryService = {
  async list(active?: boolean): Promise<Category[]> {
    const query = active !== undefined ? `?active=${active}` : "";
    const response = await fetch(`/api/categories${query}`, { credentials: "include" });
    const data = await parseEnvelope<unknown[]>(response);
    return data.map((item) => CategorySchema.parse(item));
  },

  async create(payload: CreateCategoryFormValues): Promise<Category> {
    const response = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return CategorySchema.parse(await parseEnvelope<unknown>(response));
  },

  async update(id: string, payload: EditCategoryFormValues): Promise<Category> {
    const response = await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return CategorySchema.parse(await parseEnvelope<unknown>(response));
  },

  async updateStatus(id: string, active: boolean): Promise<Category> {
    const response = await fetch(`/api/categories/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ active }),
    });
    return CategorySchema.parse(await parseEnvelope<unknown>(response));
  },
};
