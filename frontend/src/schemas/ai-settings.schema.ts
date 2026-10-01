import { z } from "zod";
import { AiSettingsRecordSchema } from "../../../shared/dist/schemas/ai-settings.schema.js";

/** Configuração do provedor de IA (spec 013) — devolvida pela API, já gravada. Nunca inclui
 * `apiKey` (cifrada ou não), só `apiKeyPreview`. */
export { AiSettingsRecordSchema };
export type AiSettingsRecord = z.infer<typeof AiSettingsRecordSchema>;

/**
 * Formulário de edição — `apiKey` sempre começa vazio (nunca populado com o valor real nem com
 * `apiKeyPreview`, spec 013 seção 3): deixar em branco no submit preserva a chave atual; a
 * obrigatoriedade de `apiKey`/`model` só na primeira configuração é decidida pelo backend
 * (`AiSettingsIncompleteError`, 400 claro), não replicada aqui no cliente.
 */
export const AiSettingsFormSchema = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
});
export type AiSettingsFormValues = z.infer<typeof AiSettingsFormSchema>;

export const DEFAULT_AI_SETTINGS_FORM_VALUES: AiSettingsFormValues = { baseUrl: "", model: "", apiKey: "" };
