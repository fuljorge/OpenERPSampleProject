import { getDb } from "../database/mongo.client.js";
import { productRepository } from "../repositories/product.repository.js";
import {
  ProductSchema,
  type CreateProductInput,
  type ListProductsQuery,
  type Product,
  type ProductStatus,
  type UpdateProductInput,
} from "../schemas/product.schema.js";
import { assertCategoryActive } from "./category.service.js";
import { generateNextSku } from "./sku.service.js";
import { buildProductFilter } from "./product-search.service.js";
import { record } from "./audit-log.service.js";

export class ProductNotFoundError extends Error {
  constructor() {
    super("Produto não encontrado.");
    this.name = "ProductNotFoundError";
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: ProductStatus, to: ProductStatus) {
    super(`Transição de status inválida: "${from}" → "${to}".`);
    this.name = "InvalidStatusTransitionError";
  }
}

/**
 * Fluxo normal declarado na spec: rascunho → em_revisao → disponivel → reservado → vendido.
 * `inativo` é alcançável de qualquer estado. Adições não explícitas na spec, decididas na
 * implementação (documentadas em tasks.md): `em_revisao → rascunho` (devolver para correção),
 * `disponivel → vendido` direto (nem toda venda passa por reserva), `reservado → disponivel`
 * (cancelar reserva), `inativo → rascunho` (reativar, mesmo espírito do soft-delete
 * reversível de 002/003).
 */
const ALLOWED_TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  rascunho: ["em_revisao", "inativo"],
  em_revisao: ["rascunho", "disponivel", "inativo"],
  disponivel: ["reservado", "vendido", "inativo"],
  reservado: ["disponivel", "vendido", "inativo"],
  vendido: ["inativo"],
  inativo: ["rascunho"],
};

export function isValidStatusTransition(from: ProductStatus, to: ProductStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export interface CreateProductServiceInput extends CreateProductInput {
  actingUserId: string;
}

export async function createProduct(input: CreateProductServiceInput): Promise<Product> {
  const { actingUserId, ...data } = input;

  const category = await assertCategoryActive(data.classificacao.categoria_codigo);
  const sku = await generateNextSku(data.classificacao.categoria_codigo);

  const now = new Date();
  const candidate = {
    sku,
    status: data.status,
    identificacao: { ...data.identificacao, data_cadastro: now },
    classificacao: { ...data.classificacao, categoria: category.name, departamento: category.department },
    marca: data.marca ?? {},
    caracteristicas: data.caracteristicas ?? {},
    medidas: data.medidas ?? {},
    peso: data.peso ?? {},
    condicao: data.condicao,
    preco: data.preco ?? {},
    estoque: data.estoque ?? {},
    imagens: data.imagens ?? { principal: null, galeria: [] },
    ecommerce: {
      ...(data.ecommerce ?? {}),
      slug: data.ecommerce?.slug ?? slugify(data.identificacao.nome),
    },
    marketplaces: [],
    venda: {},
    ai_metadata: data.ai_metadata ?? {},
    auditoria: {
      criado_por: actingUserId,
      criado_em: now,
      atualizado_por: actingUserId,
      atualizado_em: now,
    },
  };

  // Revalida o candidato inteiro contra o schema canônico — única fonte de verdade do shape
  // final do documento (aplica todos os defaults de novo, garante consistência).
  const validated = ProductSchema.omit({ id: true }).parse(candidate);

  const db = getDb();
  const product = await productRepository.create(db, validated);

  // `ai_generated` sempre presente (não só quando true) — permite filtrar auditoria por
  // origem do cadastro sem depender de uma chave ausente (006, spec seção "Conformidade").
  await record("PRODUCT_CREATE", "product", product.id, actingUserId, {
    sku: product.sku,
    nome: product.identificacao.nome,
    ai_generated: product.ai_metadata.generated,
  });

  return product;
}

export async function getProductById(id: string): Promise<Product> {
  const db = getDb();
  const product = await productRepository.findById(db, id);
  if (!product) throw new ProductNotFoundError();
  return product;
}

export async function listProducts(
  query: ListProductsQuery,
): Promise<{ items: Product[]; total: number; page: number; limit: number }> {
  const db = getDb();
  const filter = buildProductFilter(query);
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    productRepository.list(db, filter, { skip, limit: query.limit }),
    productRepository.count(db, filter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function updateProduct(
  id: string,
  patch: UpdateProductInput,
  actingUserId: string,
): Promise<Product> {
  const db = getDb();
  const before = await productRepository.findById(db, id);
  if (!before) throw new ProductNotFoundError();

  if (patch.status !== undefined && !isValidStatusTransition(before.status, patch.status)) {
    throw new InvalidStatusTransitionError(before.status, patch.status);
  }

  const finalPatch: Record<string, unknown> = {
    ...patch,
    auditoria: { atualizado_por: actingUserId, atualizado_em: new Date() },
  };

  // Categoria alterada: revalida contra a taxonomia ativa (003) e deriva categoria/departamento
  // de novo — nunca confiar em valor de texto livre enviado pelo cliente para esses dois.
  if (
    patch.classificacao?.categoria_codigo !== undefined &&
    patch.classificacao.categoria_codigo !== before.classificacao.categoria_codigo
  ) {
    const category = await assertCategoryActive(patch.classificacao.categoria_codigo);
    finalPatch.classificacao = {
      ...patch.classificacao,
      categoria: category.name,
      departamento: category.department,
    };
  }

  // Transição para "vendido": garante venda.vendido=true e data_venda, mesmo se o cliente não
  // enviou (o status é a fonte de verdade; venda.* é o registro redundante para histórico).
  if (patch.status === "vendido" && before.status !== "vendido") {
    finalPatch.venda = {
      ...patch.venda,
      vendido: true,
      data_venda: patch.venda?.data_venda ?? new Date(),
    };
  }

  await productRepository.update(db, id, finalPatch);
  const after = await getProductById(id);

  // Cada PATCH gera o(s) registro(s) de auditoria mais específico(s) que se aplicam — nunca
  // um PRODUCT_UPDATE genérico redundante quando já existe uma ação mais específica (ex.:
  // alterar só o preço deve gerar só PRICE_UPDATE, não PRICE_UPDATE + PRODUCT_UPDATE).
  let specificActionRecorded = false;

  if (
    patch.preco?.preco_venda !== undefined &&
    patch.preco.preco_venda !== before.preco.preco_venda
  ) {
    await record("PRICE_UPDATE", "product", id, actingUserId, {
      oldValue: before.preco.preco_venda,
      newValue: after.preco.preco_venda,
    });
    specificActionRecorded = true;
  }

  if (patch.status === "inativo" && before.status !== "inativo") {
    await record("PRODUCT_DISABLE", "product", id, actingUserId);
    specificActionRecorded = true;
  } else if (patch.status === "vendido" && before.status !== "vendido") {
    await record("PRODUCT_SOLD", "product", id, actingUserId, {
      valor_venda: after.venda.valor_venda,
    });
    specificActionRecorded = true;
  } else if (patch.ecommerce?.publicado === true && before.ecommerce.publicado !== true) {
    await record("PRODUCT_PUBLISH", "product", id, actingUserId);
    specificActionRecorded = true;
  }

  if (!specificActionRecorded) {
    await record("PRODUCT_UPDATE", "product", id, actingUserId);
  }

  return after;
}

/** Exclusão lógica — `DELETE /api/products/:id` (constituição, princípio VIII). */
export async function softDeleteProduct(id: string, actingUserId: string): Promise<void> {
  const db = getDb();
  const before = await productRepository.findById(db, id);
  if (!before) throw new ProductNotFoundError();

  if (before.status === "inativo") return;

  await productRepository.softDelete(db, id);
  await record("PRODUCT_DISABLE", "product", id, actingUserId);
}
