import type { Filter } from "mongodb";
import type { ProductDocument } from "../repositories/product.repository.js";
import type { ListProductsQuery } from "../schemas/product.schema.js";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Monta o filtro MongoDB a partir dos query params suportados (spec 005, seção 5). */
export function buildProductFilter(query: ListProductsQuery): Filter<ProductDocument> {
  const filter: Filter<ProductDocument> = {};

  if (query.search) {
    const regex = { $regex: escapeRegex(query.search), $options: "i" };
    filter.$or = [{ "identificacao.nome": regex }, { sku: regex }];
  }
  if (query.categoria_codigo) filter["classificacao.categoria_codigo"] = query.categoria_codigo;
  if (query.subcategoria) filter["classificacao.subcategoria"] = query.subcategoria;
  if (query.departamento) filter["classificacao.departamento"] = query.departamento;
  if (query.marca) filter["marca.nome"] = { $regex: escapeRegex(query.marca), $options: "i" };
  if (query.tamanho) filter["caracteristicas.tamanho_etiqueta"] = query.tamanho;
  if (query.cor) filter["caracteristicas.cor_principal"] = { $regex: escapeRegex(query.cor), $options: "i" };
  if (query.estado) filter["condicao.estado"] = query.estado;
  if (query.status) filter.status = query.status;

  if (query.preco_min !== undefined || query.preco_max !== undefined) {
    filter["preco.preco_venda"] = {
      ...(query.preco_min !== undefined ? { $gte: query.preco_min } : {}),
      ...(query.preco_max !== undefined ? { $lte: query.preco_max } : {}),
    };
  }

  if (query.cadastrado_de !== undefined || query.cadastrado_ate !== undefined) {
    filter["identificacao.data_cadastro"] = {
      ...(query.cadastrado_de !== undefined ? { $gte: query.cadastrado_de } : {}),
      ...(query.cadastrado_ate !== undefined ? { $lte: query.cadastrado_ate } : {}),
    };
  }

  return filter;
}
