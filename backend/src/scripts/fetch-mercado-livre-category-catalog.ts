import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * T057 (spec 012, seção 4; ADR-025) — levanta a lista curada de categorias-folha da sub-árvore
 * "Calçados, Roupas e Bolsas" do site MLB, para a tela de revisão de categoria (T059). Usa só o
 * endpoint público `GET /categories/{id}` (sem token — `GET /sites/MLB/categories`, a listagem
 * plana, respondeu 403 "PolicyAgent" nos testes; a busca por id individual, que devolve
 * `children_categories`, funciona normalmente). Uma folha é uma categoria sem filhos — só essas
 * aceitam `POST /items`.
 *
 * Raiz confirmada em 22/09/2026 via `GET /categories/MLB1430` → `path_from_root` de uma folha
 * conhecida (Camisas, MLB107292): `MLB1430` = "Calçados, Roupas e Bolsas".
 *
 * Roda raramente — só de novo se o Mercado Livre mudar essa taxonomia. Resultado versionado em
 * `mercado-livre-category-catalog.json` (não é `MERCADO_LIVRE_PACKAGE_DEFAULTS`/env var: é dado de
 * taxonomia do Mercado Livre, não configuração da dona do brechó).
 *
 * Uso: npm run fetch:mercado-livre-categories
 */

const ROOT_CATEGORY_ID = "MLB1430"; // "Calçados, Roupas e Bolsas"
const OUTPUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "plugins",
  "marketplaces",
  "mercado-livre-category-catalog.json",
);
const MAX_CONCURRENT_REQUESTS = 5;
const REQUEST_TIMEOUT_MS = 15_000;

interface MercadoLivreCategoryNode {
  id: string;
  name: string;
  children_categories?: { id: string; name: string }[];
}

export interface CuratedCategory {
  categoryId: string;
  categoryName: string;
}

/** Limita quantas chamadas rodam ao mesmo tempo — API pública, mas sem motivo para martelar. */
function createLimiter(max: number) {
  let running = 0;
  const queue: (() => void)[] = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    running += 1;
    try {
      return await fn();
    } finally {
      running -= 1;
      queue.shift()?.();
    }
  };
}

async function fetchCategory(id: string): Promise<MercadoLivreCategoryNode> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.mercadolibre.com/categories/${id}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GET /categories/${id} devolveu ${response.status}`);
    }
    return (await response.json()) as MercadoLivreCategoryNode;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const limit = createLimiter(MAX_CONCURRENT_REQUESTS);
  const leaves: CuratedCategory[] = [];
  let visitedCount = 0;

  console.log(`Levantando categorias-folha a partir de ${ROOT_CATEGORY_ID}...`);

  async function walk(id: string): Promise<void> {
    const category = await limit(() => fetchCategory(id));
    visitedCount += 1;

    const children = category.children_categories ?? [];
    if (children.length === 0) {
      leaves.push({ categoryId: category.id, categoryName: category.name });
      return;
    }

    await Promise.all(children.map((child) => walk(child.id)));
  }

  await walk(ROOT_CATEGORY_ID);

  leaves.sort((a, b) => a.categoryName.localeCompare(b.categoryName, "pt-BR"));
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(leaves, null, 2)}\n`, "utf8");

  console.log(`Categorias visitadas: ${visitedCount}`);
  console.log(`Categorias-folha gravadas: ${leaves.length} → ${OUTPUT_PATH}`);
}

main().catch((err: unknown) => {
  console.error("Falha ao levantar o catálogo de categorias:", err);
  process.exitCode = 1;
});
