import { createProduct, type CreateProductServiceInput } from "./product.service.js";
import type { Product } from "../schemas/product.schema.js";

/**
 * Persiste o produto revisado pelo operador após o fluxo de cadastro por IA (spec 006, seção
 * 6). Reaproveita integralmente `product.service.createProduct` (005) — mesma validação Zod
 * completa, mesma geração de SKU atômica (004), mesmo registro de auditoria
 * (`PRODUCT_CREATE`); a única diferença do cadastro manual é a origem dos dados (revisão de
 * sugestão de IA vs. digitação direta), que não exige nenhuma regra de negócio distinta na
 * persistência — por isso este arquivo é intencionalmente um repasse fino, não uma
 * reimplementação (constituição, princípio V).
 */
export async function confirmProduct(input: CreateProductServiceInput): Promise<Product> {
  return createProduct(input);
}
