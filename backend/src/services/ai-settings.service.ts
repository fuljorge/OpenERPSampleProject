import { getDb } from "../database/mongo.client.js";
import { aiSettingsRepository } from "../repositories/ai-settings.repository.js";
import type { AiSettingsInput, AiSettingsRecord } from "../schemas/ai-settings.schema.js";
import { encryptCredential, decryptCredential, maskCredential } from "./credential-encryption.service.js";
import { record } from "./audit-log.service.js";

/**
 * Configuração do provedor de IA (spec 013) — substitui `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL`
 * do `.env` (spec 006, seção 5) por um documento único editável em runtime, com a API key
 * cifrada pelo mesmo mecanismo de credenciais de marketplace (spec 011, seção 3.1; ADR-021) —
 * nenhum esquema de criptografia novo, só reaproveitado.
 */

export class AiSettingsIncompleteError extends Error {
  constructor() {
    super("Informe ao menos o modelo e a API key na primeira configuração do provedor de IA.");
    this.name = "AiSettingsIncompleteError";
  }
}

export interface ResolvedAiSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Uso interno (constrói o adapter de IA, `ai-intake.service.ts`) — nunca exposto por rota. */
export async function getAiSettings(): Promise<ResolvedAiSettings | null> {
  const settings = await aiSettingsRepository.find(getDb());
  if (!settings) return null;

  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: await decryptCredential(settings.apiKey),
  };
}

/** O que a rota `GET /api/settings/ai` expõe — nunca a chave, cifrada ou não. */
export async function getAiSettingsForDisplay(): Promise<AiSettingsRecord | null> {
  const settings = await aiSettingsRepository.find(getDb());
  if (!settings) return null;

  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyPreview: settings.apiKeyPreview,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

export async function updateAiSettings(input: AiSettingsInput, actingAdminId: string): Promise<AiSettingsRecord> {
  const db = getDb();
  const before = await aiSettingsRepository.find(db);

  // Primeira configuração: não existe "manter o valor atual" pra apiKey/model, então os dois
  // passam a ser obrigatórios só neste caso — baseUrl continua opcional (vazio = OpenAI oficial,
  // spec 006 seção 5).
  if (!before && (!input.apiKey || !input.model)) {
    throw new AiSettingsIncompleteError();
  }

  const patch = {
    // Na primeira configuração, `baseUrl` sempre precisa virar uma string de verdade no
    // documento (mesmo "") — se ficasse `undefined`, o driver do Mongo (`ignoreUndefined`)
    // simplesmente omite o campo do documento, e a chave some da resposta JSON adiante
    // (`AiSettingsRecordSchema.baseUrl` não é opcional) — achado real testando esta fase.
    // Numa edição, `undefined` continua significando "não mexer" normalmente.
    baseUrl: input.baseUrl ?? (before ? undefined : ""),
    model: input.model,
    apiKey: input.apiKey !== undefined ? await encryptCredential(input.apiKey) : undefined,
    apiKeyPreview: input.apiKey !== undefined ? maskCredential(input.apiKey) : undefined,
  };

  const updated = await aiSettingsRepository.upsert(db, patch, actingAdminId);

  // baseUrl/model não são segredo — registra valor antigo/novo (mesmo padrão de PRICE_UPDATE,
  // spec 008). apiKey nunca aparece, nem como pista: só um booleano dizendo se foi trocada
  // (mesma regra de MARKETPLACE_ACCOUNT_UPDATE, spec 011, seção 3).
  await record("AI_SETTINGS_UPDATE", "ai_settings", "default", actingAdminId, {
    baseUrl: { old: before?.baseUrl ?? null, new: updated.baseUrl },
    model: { old: before?.model ?? null, new: updated.model },
    apiKeyChanged: input.apiKey !== undefined,
  });

  return { baseUrl: updated.baseUrl, model: updated.model, apiKeyPreview: updated.apiKeyPreview, updatedAt: updated.updatedAt, updatedBy: updated.updatedBy };
}
