import type { Collection, Db } from "mongodb";

/**
 * Configuração do provedor de IA (spec 013) — documento único (`_id: "default"`), mesmo padrão
 * de `mercado-livre-package-settings.repository.ts` (spec 012, seção 3.4; ADR-027).
 * `findOneAndUpdate` com `upsert: true` grava sempre no mesmo `_id`, então duas edições
 * concorrentes nunca criam um segundo documento.
 *
 * `apiKey` aqui é sempre o valor **cifrado** (`{keyId}:{iv}:{authTag}:{dados}`,
 * `credential-encryption.service.ts`) — este repositório nunca vê nem grava texto puro.
 */
const DOC_ID = "default";

export interface AiSettingsRecord {
  baseUrl: string;
  model: string;
  apiKey: string;
  apiKeyPreview: string;
  updatedAt: Date;
  updatedBy: string;
}

interface AiSettingsDocument extends AiSettingsRecord {
  _id: string;
}

function collection(db: Db): Collection<AiSettingsDocument> {
  return db.collection<AiSettingsDocument>("ai_settings");
}

function toRecord(doc: AiSettingsDocument): AiSettingsRecord {
  return {
    baseUrl: doc.baseUrl,
    model: doc.model,
    apiKey: doc.apiKey,
    apiKeyPreview: doc.apiKeyPreview,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy,
  };
}

export const aiSettingsRepository = {
  async find(db: Db): Promise<AiSettingsRecord | null> {
    const doc = await collection(db).findOne({ _id: DOC_ID });
    return doc ? toRecord(doc) : null;
  },

  /** `values` já é o patch completo a aplicar (o service decide o que muda e o que mantém —
   * este repositório só grava, nunca decide merge de negócio). */
  async upsert(db: Db, values: Partial<Omit<AiSettingsRecord, "updatedAt" | "updatedBy">>, updatedBy: string): Promise<AiSettingsRecord> {
    const updatedAt = new Date();
    const result = await collection(db).findOneAndUpdate(
      { _id: DOC_ID },
      { $set: { ...values, updatedAt, updatedBy } },
      { upsert: true, returnDocument: "after" },
    );
    if (!result) {
      throw new Error("Falha ao gravar a configuração do provedor de IA.");
    }
    return toRecord(result);
  },
};
