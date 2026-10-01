import { AiSettingsRecordSchema, type AiSettingsFormValues, type AiSettingsRecord } from "../schemas/ai-settings.schema";

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

export const aiSettingsService = {
  /** `null` se o provedor de IA ainda não foi configurado (spec 013). */
  async get(): Promise<AiSettingsRecord | null> {
    const response = await fetch("/api/settings/ai", { credentials: "include" });
    const data = await parseEnvelope<unknown>(response);
    return data === null ? null : AiSettingsRecordSchema.parse(data);
  },

  /** Campos vazios/omitidos não alteram o valor atual — `apiKey` vazio nunca é enviado (ver
   * `AiSettingsPage.tsx`: só entra no corpo quando o operador de fato digitou algo). */
  async update(values: AiSettingsFormValues): Promise<AiSettingsRecord> {
    const payload: Record<string, string> = {};
    if (values.baseUrl) payload.baseUrl = values.baseUrl;
    if (values.model) payload.model = values.model;
    if (values.apiKey) payload.apiKey = values.apiKey;

    const response = await fetch("/api/settings/ai", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return AiSettingsRecordSchema.parse(await parseEnvelope<unknown>(response));
  },
};
