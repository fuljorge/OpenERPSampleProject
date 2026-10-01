import { getDb } from "../database/mongo.client.js";
import { categoryRepository, type Category } from "../repositories/category.repository.js";
import { record } from "./audit-log.service.js";

export class CategoryCodeAlreadyExistsError extends Error {
  constructor() {
    super("Já existe uma categoria com este código.");
    this.name = "CategoryCodeAlreadyExistsError";
  }
}

export class CategoryNotFoundError extends Error {
  constructor() {
    super("Categoria não encontrada.");
    this.name = "CategoryNotFoundError";
  }
}

/** Lançado por `assertCategoryActive` — código inexistente ou de categoria inativa. */
export class InvalidCategoryError extends Error {
  constructor(code: string) {
    super(`Categoria "${code}" não existe ou não está ativa.`);
    this.name = "InvalidCategoryError";
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 11000;
}

export interface CreateCategoryServiceInput {
  code: string;
  name: string;
  department: string;
  actingAdminId: string;
}

export async function createCategory(input: CreateCategoryServiceInput): Promise<Category> {
  const db = getDb();

  // Checagem prévia para erro de negócio claro; a garantia real contra corrida é o índice
  // único em `categories.code` (ver mongo.client.ts, ensureIndexes) — por isso o catch abaixo
  // também trata erro de chave duplicada.
  const existing = await categoryRepository.findByCode(db, input.code);
  if (existing) {
    throw new CategoryCodeAlreadyExistsError();
  }

  let category: Category;
  try {
    category = await categoryRepository.create(db, {
      code: input.code,
      name: input.name,
      department: input.department,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new CategoryCodeAlreadyExistsError();
    }
    throw err;
  }

  await record("CATEGORY_CREATE", "category", category.id, input.actingAdminId, {
    code: category.code,
    name: category.name,
    department: category.department,
  });

  return category;
}

export async function listCategories(active?: boolean): Promise<Category[]> {
  const db = getDb();
  return categoryRepository.list(db, { active });
}

export async function getCategoryById(id: string): Promise<Category> {
  const db = getDb();
  const category = await categoryRepository.findById(db, id);
  if (!category) throw new CategoryNotFoundError();
  return category;
}

export async function updateCategoryProfile(
  id: string,
  input: { name?: string; department?: string },
  actingAdminId: string,
): Promise<Category> {
  const db = getDb();
  const before = await categoryRepository.findById(db, id);
  if (!before) throw new CategoryNotFoundError();

  await categoryRepository.updateProfile(db, id, input);
  const after = await getCategoryById(id);

  await record("CATEGORY_UPDATE", "category", id, actingAdminId, {
    ...(input.name !== undefined ? { name: { oldValue: before.name, newValue: after.name } } : {}),
    ...(input.department !== undefined
      ? { department: { oldValue: before.department, newValue: after.department } }
      : {}),
  });

  return after;
}

export async function updateCategoryStatus(
  id: string,
  active: boolean,
  actingAdminId: string,
): Promise<Category> {
  const db = getDb();
  const before = await categoryRepository.findById(db, id);
  if (!before) throw new CategoryNotFoundError();

  await categoryRepository.updateStatus(db, id, active);

  // Sem ação dedicada de "reativar" no enum de auditoria (008) — desativar usa
  // CATEGORY_DISABLE (nomeada explicitamente na spec de auditoria), qualquer outra transição
  // (incluindo voltar a active) usa CATEGORY_UPDATE. Mesmo padrão de user.service.ts (002).
  const action = active ? "CATEGORY_UPDATE" : "CATEGORY_DISABLE";
  await record(action, "category", id, actingAdminId, { oldValue: before.active, newValue: active });

  return getCategoryById(id);
}

/**
 * Fronteira que impede uso de categoria fora da taxonomia ativa (constituição, princípio I)
 * — consumida por 004-sku, 005-produtos e 006-produtos-cadastro-ia. Nunca reimplementar essa
 * checagem nesses módulos.
 */
export async function assertCategoryActive(code: string): Promise<Category> {
  const db = getDb();
  const category = await categoryRepository.findByCode(db, code);
  if (!category || !category.active) {
    throw new InvalidCategoryError(code);
  }
  return category;
}
