import { getDb } from "../database/mongo.client.js";
import { skuSequenceRepository } from "../repositories/sku-sequence.repository.js";
import { assertCategoryActive } from "./category.service.js";

/**
 * Gera o próximo SKU de uma categoria (`ERP-{CATEGORIA}-{SEQUENCIA:6 dígitos}`), sempre via
 * incremento atômico (constituição, princípio III). Valida a categoria antes de incrementar
 * — evita criar sequências órfãs para códigos inválidos e é a mesma fronteira que impede a
 * IA de usar categoria fora da taxonomia (003).
 *
 * Só pode ser chamada no momento exato da persistência final do produto (`POST /products` em
 * 005, `POST /products/confirm` em 006) — nunca durante a análise de IA.
 */
export async function generateNextSku(categoryCode: string): Promise<string> {
  await assertCategoryActive(categoryCode);

  const db = getDb();
  const sequence = await skuSequenceRepository.incrementAndGet(db, categoryCode);
  return `ERP-${categoryCode}-${String(sequence).padStart(6, "0")}`;
}
