import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Lista curada de categorias-folha do Mercado Livre para a tela de revisão de categoria (spec
 * 012, seção 4; ADR-025) — congelada em `mercado-livre-category-catalog.json` (T057), não numa
 * variável de ambiente: é dado de taxonomia do Mercado Livre, não uma preferência operacional da
 * dona do brechó (diferente de `mercado-livre-package.config.ts`). Leitura tardia a cada chamada
 * (arquivo pequeno, local, sem custo real de I/O) — mesma razão de não congelar no carregamento
 * do módulo que `mercado-livre-package.config.ts`: facilita testar com arquivos diferentes.
 */

// `tsc` só compila .ts — não copia este .json para dist/ sozinho. O script `postbuild` do
// package.json copia para o mesmo caminho relativo em dist/plugins/marketplaces/ depois de todo
// `npm run build` (local, CI e a imagem Docker de produção passam por ele igual). Sem isso, o
// arquivo existe em src/ mas falta em dist/ em produção — foi exatamente esse o sintoma real no
// primeiro teste de publicação (22/09/2026): "Catálogo não encontrado em
// /app/backend/dist/plugins/marketplaces/...", mesmo com o arquivo commitado no repositório.
const CATALOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "mercado-livre-category-catalog.json");

export interface CuratedCategory {
  categoryId: string;
  categoryName: string;
}

export class CategoryCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CategoryCatalogError";
  }
}

/**
 * Devolve a lista curada. Nunca lança por arquivo ausente/vazio em produção sem contexto —
 * mensagem sempre orienta a rodar `npm run fetch:mercado-livre-categories` (T057).
 */
export function getCuratedCategories(): CuratedCategory[] {
  let raw: string;
  try {
    raw = readFileSync(CATALOG_PATH, "utf8");
  } catch {
    throw new CategoryCatalogError(
      `Catálogo de categorias do Mercado Livre não encontrado em ${CATALOG_PATH}. Rode ` +
        "\"npm run fetch:mercado-livre-categories\" (T057) para gerá-lo.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CategoryCatalogError(
      "Catálogo de categorias do Mercado Livre é um JSON inválido — rode " +
        "\"npm run fetch:mercado-livre-categories\" (T057) para regerá-lo.",
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new CategoryCatalogError(
      "Catálogo de categorias do Mercado Livre está vazio — rode " +
        "\"npm run fetch:mercado-livre-categories\" (T057) para gerá-lo.",
    );
  }

  return parsed.map((entry, index) => {
    const item = entry as Partial<CuratedCategory>;
    if (typeof item.categoryId !== "string" || typeof item.categoryName !== "string") {
      throw new CategoryCatalogError(`Catálogo de categorias do Mercado Livre tem uma entrada inválida no índice ${index}.`);
    }
    return { categoryId: item.categoryId, categoryName: item.categoryName };
  });
}
