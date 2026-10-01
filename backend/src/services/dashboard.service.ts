import { getDb } from "../database/mongo.client.js";
import type { ProductDocument } from "../repositories/product.repository.js";

export interface DashboardSummary {
  disponiveis: number;
  cadastradosHoje: number;
  vendidos: number;
  emRevisao: number;
  semPreco: number;
  semImagens: number;
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Agrega os 6 indicadores do MVP (spec 009, seção 2) — todos derivados de `products`, sem
 * cache (constituição, princípio V). "Hoje" usa o fuso horário do processo do servidor (sem
 * requisito de timezone explícito na spec); aceitável para o MVP.
 *
 * "Sem preço"/"sem imagens" excluem produtos `inativo` (decisão de implementação, não
 * literal na spec/plan.md) — são indicadores de "precisa de atenção operacional", e um
 * produto já excluído logicamente não deveria inflar essa contagem.
 */
export async function getSummary(): Promise<DashboardSummary> {
  const db = getDb();
  const products = db.collection<ProductDocument>("products");

  const [disponiveis, cadastradosHoje, vendidos, emRevisao, semPreco, semImagens] = await Promise.all([
    products.countDocuments({ status: "disponivel" }),
    products.countDocuments({ "identificacao.data_cadastro": { $gte: startOfToday() } }),
    products.countDocuments({ status: "vendido" }),
    products.countDocuments({ status: "em_revisao" }),
    products.countDocuments({ "preco.preco_venda": null, status: { $ne: "inativo" } }),
    products.countDocuments({
      "imagens.principal": null,
      "imagens.galeria": { $size: 0 },
      status: { $ne: "inativo" },
    }),
  ]);

  return { disponiveis, cadastradosHoje, vendidos, emRevisao, semPreco, semImagens };
}
