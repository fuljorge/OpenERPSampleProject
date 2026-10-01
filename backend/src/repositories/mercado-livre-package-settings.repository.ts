import type { Collection, Db } from "mongodb";
import type { MercadoLivrePackageSettings } from "../../../shared/dist/schemas/mercado-livre-package-settings.schema.js";

/**
 * Pacote padrão do Mercado Livre (spec 012, seção 3.4; ADR-027) — documento único (`_id: "default"`),
 * editado pela tela de admin. `findOneAndUpdate` com `upsert: true` grava sempre no mesmo `_id`,
 * então duas edições concorrentes nunca criam um segundo documento.
 */
const DOC_ID = "default";

interface MercadoLivrePackageSettingsDocument extends MercadoLivrePackageSettings {
  _id: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface MercadoLivrePackageSettingsRecord extends MercadoLivrePackageSettings {
  updatedAt: Date;
  updatedBy: string;
}

function collection(db: Db): Collection<MercadoLivrePackageSettingsDocument> {
  return db.collection<MercadoLivrePackageSettingsDocument>("mercado_livre_package_settings");
}

function toRecord(doc: MercadoLivrePackageSettingsDocument): MercadoLivrePackageSettingsRecord {
  return {
    altura_cm: doc.altura_cm,
    largura_cm: doc.largura_cm,
    comprimento_cm: doc.comprimento_cm,
    peso_g: doc.peso_g,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy,
  };
}

export const mercadoLivrePackageSettingsRepository = {
  async find(db: Db): Promise<MercadoLivrePackageSettingsRecord | null> {
    const doc = await collection(db).findOne({ _id: DOC_ID });
    return doc ? toRecord(doc) : null;
  },

  async upsert(db: Db, values: MercadoLivrePackageSettings, updatedBy: string): Promise<MercadoLivrePackageSettingsRecord> {
    const updatedAt = new Date();
    const result = await collection(db).findOneAndUpdate(
      { _id: DOC_ID },
      { $set: { ...values, updatedAt, updatedBy } },
      { upsert: true, returnDocument: "after" },
    );
    if (!result) {
      throw new Error("Falha ao gravar o pacote padrão do Mercado Livre.");
    }
    return toRecord(result);
  },
};
