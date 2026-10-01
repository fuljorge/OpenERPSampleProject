import { UserSchema, type EditUserFormValues, type User } from "../schemas/user.schema";

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

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: User["role"];
  status?: User["status"];
}

export const userService = {
  async list(search?: string): Promise<User[]> {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    const response = await fetch(`/api/users${query}`, { credentials: "include" });
    const data = await parseEnvelope<unknown[]>(response);
    return data.map((item) => UserSchema.parse(item));
  },

  async getById(id: string): Promise<User> {
    const response = await fetch(`/api/users/${id}`, { credentials: "include" });
    return UserSchema.parse(await parseEnvelope<unknown>(response));
  },

  async create(payload: CreateUserPayload): Promise<User> {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return UserSchema.parse(await parseEnvelope<unknown>(response));
  },

  async update(id: string, payload: EditUserFormValues): Promise<User> {
    const response = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return UserSchema.parse(await parseEnvelope<unknown>(response));
  },

  async updateStatus(id: string, status: User["status"]): Promise<User> {
    const response = await fetch(`/api/users/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status }),
    });
    return UserSchema.parse(await parseEnvelope<unknown>(response));
  },
};
