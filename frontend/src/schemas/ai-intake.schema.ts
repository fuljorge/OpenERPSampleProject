import { AiSuggestedProductSchema } from "../../../shared/dist/schemas/ai-intake.schema.js";
import type { AiSuggestedProduct } from "../../../shared/dist/schemas/ai-intake.schema.js";
import { DEFAULT_PRODUCT_FORM_VALUES, type ProductFormValues } from "./product.schema";

export { AiSuggestedProductSchema };
export type { AiSuggestedProduct };

function numberOrEmpty(value: number | null): string {
  return value === null ? "" : String(value);
}

function joinList(list: string[]): string {
  return list.join(", ");
}

/**
 * Preenche o formulário de revisão (`ProductForm`, 005) a partir da sugestão da IA. Campos que
 * a IA nunca sugere (preço, estoque, e-commerce — spec 006, seção 7) ficam com os valores de
 * `base`, para o operador preencher/conferir manualmente; nada aqui é salvo até o clique
 * explícito em "Salvar produto"/"Salvar alterações" (Human in the Loop, constituição princípio
 * II). No cadastro (`AiReviewForm.tsx`), `base` é omitido e assume o default em branco. Na
 * reavaliação de um produto já cadastrado (spec 006, seção 9; `ProductForm.tsx`, 005 seção 4.3),
 * `base` é o formulário de edição já aberto (`getValues()`) — preserva preço/estoque/
 * e-commerce/status/sku/fotos intocados, únicos campos que `AiSuggestedProductSchema`
 * estruturalmente não sugere.
 */
export function aiSuggestionToFormValues(
  suggestion: AiSuggestedProduct,
  base: ProductFormValues = DEFAULT_PRODUCT_FORM_VALUES,
): ProductFormValues {
  return {
    ...base,
    nome: suggestion.identificacao.nome ?? "",
    descricao: suggestion.identificacao.descricao ?? "",
    categoria_codigo: suggestion.classificacao.categoria_codigo ?? "",
    subcategoria: suggestion.classificacao.subcategoria ?? "",
    estilo: joinList(suggestion.classificacao.estilo),
    ocasiao: joinList(suggestion.classificacao.ocasiao),
    estacao: joinList(suggestion.classificacao.estacao),
    marca_nome: suggestion.marca.nome ?? "",
    marca_original: suggestion.marca.original === null ? "" : suggestion.marca.original ? "sim" : "nao",
    tamanho_etiqueta: suggestion.caracteristicas.tamanho_etiqueta ?? "",
    tamanho_equivalente: suggestion.caracteristicas.tamanho_equivalente ?? "",
    genero: suggestion.caracteristicas.genero ?? "",
    cor_principal: suggestion.caracteristicas.cor_principal ?? "",
    cores_secundarias: joinList(suggestion.caracteristicas.cores_secundarias),
    estampa: suggestion.caracteristicas.estampa ?? "",
    material: joinList(suggestion.caracteristicas.material),
    composicao: suggestion.caracteristicas.composicao ?? "",
    lavagem: suggestion.caracteristicas.lavagem ?? "",
    modelagem: suggestion.caracteristicas.modelagem ?? "",
    elasticidade: suggestion.caracteristicas.elasticidade ?? "",
    fechamento: joinList(suggestion.caracteristicas.fechamento),
    unidade: suggestion.medidas.unidade,
    cintura: numberOrEmpty(suggestion.medidas.cintura),
    quadril: numberOrEmpty(suggestion.medidas.quadril),
    gancho: numberOrEmpty(suggestion.medidas.gancho),
    comprimento: numberOrEmpty(suggestion.medidas.comprimento),
    largura_barra: numberOrEmpty(suggestion.medidas.largura_barra),
    coxa: numberOrEmpty(suggestion.medidas.coxa),
    entrepasso: numberOrEmpty(suggestion.medidas.entrepasso),
    busto: numberOrEmpty(suggestion.medidas.busto),
    largura_ombro: numberOrEmpty(suggestion.medidas.largura_ombro),
    comprimento_manga: numberOrEmpty(suggestion.medidas.comprimento_manga),
    estado: suggestion.condicao.estado ?? "novo",
    nota: numberOrEmpty(suggestion.condicao.nota),
    possui_etiqueta: suggestion.condicao.possui_etiqueta ?? false,
    possui_defeitos: suggestion.condicao.possui_defeitos ?? false,
    defeitos: joinList(suggestion.condicao.defeitos),
    observacoes_condicao: suggestion.condicao.observacoes ?? "",
  };
}

export interface ConfidenceBadge {
  identifiedLabel: string;
  missingLabel: string;
  identified: boolean;
}

/** Lista curada de atributos mostrados como "✓ identificado / ⚠ não identificado" (spec 006,
 * seção 7) — não é a lista completa do modelo, só os campos mais relevantes para o operador
 * decidir o que revisar com mais atenção. */
const TRACKED_FIELDS: {
  identifiedLabel: string;
  missingLabel: string;
  get: (s: AiSuggestedProduct) => boolean;
}[] = [
  {
    identifiedLabel: "Categoria identificada",
    missingLabel: "Categoria não identificada",
    get: (s) => s.classificacao.categoria_codigo !== null,
  },
  {
    identifiedLabel: "Tamanho identificado",
    missingLabel: "Tamanho não identificado",
    get: (s) => s.caracteristicas.tamanho_etiqueta !== null,
  },
  {
    identifiedLabel: "Cor identificada",
    missingLabel: "Cor não identificada",
    get: (s) => s.caracteristicas.cor_principal !== null,
  },
  { identifiedLabel: "Marca identificada", missingLabel: "Marca não identificada", get: (s) => s.marca.nome !== null },
  {
    identifiedLabel: "Composição identificada",
    missingLabel: "Composição não identificada",
    get: (s) => s.caracteristicas.composicao !== null,
  },
  {
    identifiedLabel: "Estado de conservação identificado",
    missingLabel: "Estado de conservação não identificado",
    get: (s) => s.condicao.estado !== null,
  },
];

export function buildConfidenceBadges(suggestion: AiSuggestedProduct): ConfidenceBadge[] {
  return TRACKED_FIELDS.map(({ identifiedLabel, missingLabel, get }) => ({
    identifiedLabel,
    missingLabel,
    identified: get(suggestion),
  }));
}
