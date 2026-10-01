import { z } from "zod";

/**
 * Configuração do provedor de IA (spec 013) — antes só existia como variável de ambiente
 * (`AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL`, spec 006, seção 5), agora editável em runtime por
 * uma tela de admin, com a API key cifrada no banco (reaproveita o mesmo mecanismo de
 * `credential-encryption.service.ts` já usado pelas credenciais de marketplace, spec 011).
 *
 * Todos os campos de entrada são opcionais aqui — a obrigatoriedade de `apiKey`/`model` só na
 * *primeira* configuração é uma regra dinâmica (depende de já existir ou não um documento
 * salvo) resolvida em `ai-settings.service.ts`, não neste schema estático.
 */
export const AiSettingsInputSchema = z
  .object({
    baseUrl: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
  })
  .strict();
export type AiSettingsInput = z.infer<typeof AiSettingsInputSchema>;

/**
 * Registro devolvido pela API — `.strict()` é uma defesa estrutural: `apiKey` (cifrada ou não)
 * nunca deve conseguir vazar por uma rota que reuse este schema por engano (mesmo espírito da
 * defesa C de 006, seção 8.2, para o schema de sugestão da IA).
 */
export const AiSettingsRecordSchema = z
  .object({
    baseUrl: z.string(),
    model: z.string(),
    apiKeyPreview: z.string(),
    updatedAt: z.coerce.date(),
    updatedBy: z.string(),
  })
  .strict();
export type AiSettingsRecord = z.infer<typeof AiSettingsRecordSchema>;
