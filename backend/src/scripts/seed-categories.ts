import "dotenv/config";
import { connectMongo, disconnectMongo } from "../database/mongo.client.js";
import { categoryRepository } from "../repositories/category.repository.js";
import { record } from "../services/audit-log.service.js";

/**
 * Catálogo de referência (specs/003-categorias/spec.md, seção 2). `department` não é
 * atribuído pela spec para nenhum dos 11 códigos — distribuição decidida na implementação
 * (ver ADR correspondente em memory/decisions.md), editável depois pela tela de admin.
 * Idempotente: só cria os códigos que ainda não existem.
 */
const REFERENCE_CATALOG: { code: string; name: string; department: string }[] = [
  { code: "BERM", name: "Bermudas", department: "Masculino" },
  { code: "CALC", name: "Calças", department: "Masculino" },
  { code: "CAMI", name: "Camisas", department: "Masculino" },
  { code: "POLO", name: "Camisas Polo", department: "Masculino" },
  { code: "JAQU", name: "Jaquetas", department: "Masculino" },
  { code: "VEST", name: "Vestidos", department: "Feminino" },
  { code: "BLUS", name: "Blusas", department: "Feminino" },
  { code: "SAIA", name: "Saias", department: "Feminino" },
  { code: "SAPT", name: "Sapatos", department: "Unissexo" },
  { code: "BOLS", name: "Bolsas", department: "Unissexo" },
  { code: "ACES", name: "Acessórios", department: "Unissexo" },
];

async function main() {
  const db = await connectMongo();

  let created = 0;
  let skipped = 0;

  for (const entry of REFERENCE_CATALOG) {
    const existing = await categoryRepository.findByCode(db, entry.code);
    if (existing) {
      skipped += 1;
      continue;
    }

    const category = await categoryRepository.create(db, entry);
    await record("CATEGORY_CREATE", "category", category.id, undefined, {
      code: category.code,
      name: category.name,
      department: category.department,
      source: "seed-categories script",
    });
    created += 1;
    console.log(`Criada: ${entry.code} — ${entry.name} (${entry.department})`);
  }

  console.log(`\nConcluído: ${created} criada(s), ${skipped} já existiam.`);
}

main()
  .catch((err: unknown) => {
    console.error("Falha ao popular categorias:", err);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
