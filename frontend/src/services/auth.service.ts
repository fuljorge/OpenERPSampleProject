import { AuthUserSchema, type AuthUser, type LoginFormValues } from "../schemas/auth.schema";

/** Erro de uma resposta `{ success: false, error }` da API — mensagem já pronta para exibir. */
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

export const authService = {
  async login(values: LoginFormValues): Promise<AuthUser> {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(values),
    });
    return AuthUserSchema.parse(await parseEnvelope<AuthUser>(response));
  },

  async logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  },

  /** Retorna `null` quando não há sessão válida (401) — nunca lança nesse caso. */
  async me(): Promise<AuthUser | null> {
    const response = await fetch("/api/auth/me", { credentials: "include" });
    if (response.status === 401) return null;
    return AuthUserSchema.parse(await parseEnvelope<AuthUser>(response));
  },
};
