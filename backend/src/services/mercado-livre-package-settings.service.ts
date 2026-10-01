import { getDb } from "../database/mongo.client.js";
import {
  mercadoLivrePackageSettingsRepository,
  type MercadoLivrePackageSettingsRecord,
} from "../repositories/mercado-livre-package-settings.repository.js";
import { record } from "./audit-log.service.js";
import type { MercadoLivrePackageSettings } from "../../../shared/dist/schemas/mercado-livre-package-settings.schema.js";

/**
 * Pacote padrão do Mercado Livre (spec 012, seção 3.4; ADR-027) — CRUD simples de um documento
 * único, editado por admin. Diferente do desenho anterior (T046, variável de ambiente): agora é
 * lido/gravado direto no banco, sem precisar reiniciar o backend.
 */

export async function getMercadoLivrePackageSettings(): Promise<MercadoLivrePackageSettingsRecord | null> {
  return mercadoLivrePackageSettingsRepository.find(getDb());
}

export async function updateMercadoLivrePackageSettings(
  values: MercadoLivrePackageSettings,
  actingUserId: string,
): Promise<MercadoLivrePackageSettingsRecord> {
  const updated = await mercadoLivrePackageSettingsRepository.upsert(getDb(), values, actingUserId);

  await record("MERCADO_LIVRE_PACKAGE_SETTINGS_UPDATE", "mercado_livre_package_settings", "default", actingUserId, {
    altura_cm: values.altura_cm,
    largura_cm: values.largura_cm,
    comprimento_cm: values.comprimento_cm,
    peso_g: values.peso_g,
  });

  return updated;
}
