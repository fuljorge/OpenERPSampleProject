import { z } from "zod";
import {
  ProductSchema,
  ProductStatusEnum,
  CondicaoEstadoEnum,
  MedidasUnidadeEnum,
  MoedaEnum,
  CanalVendaEnum,
  GeneroEnum,
  ImagemSchema,
  MAX_PRODUCT_IMAGES,
} from "../../../shared/dist/schemas/product.schema.js";

export { ProductSchema, ProductStatusEnum, CondicaoEstadoEnum, MedidasUnidadeEnum, MoedaEnum, CanalVendaEnum, GeneroEnum, MAX_PRODUCT_IMAGES };
export type Genero = z.infer<typeof GeneroEnum>;

/** Rótulo de exibição do seletor de gênero (características do produto — spec 005). */
export const GENERO_LABELS: Record<Genero, string> = {
  masculino: "Masculino",
  feminino: "Feminino",
  menino: "Menino",
  menina: "Menina",
  unissex: "Unissex",
};
export type Moeda = z.infer<typeof MoedaEnum>;

/** Símbolo de exibição por moeda — usado tanto no seletor do formulário quanto na listagem. */
export const MOEDA_SYMBOLS: Record<Moeda, string> = {
  BRL: "R$",
  USD: "US$",
  EUR: "€",
};

/** Locale usado por `Intl.NumberFormat`/`toLocaleString` para formatar cada moeda (símbolo e
 * posicionamento corretos, ex.: "R$ 19,90" vs "$19.90" vs "19,90 €"). */
export const MOEDA_LOCALES: Record<Moeda, string> = {
  BRL: "pt-BR",
  USD: "en-US",
  EUR: "de-DE",
};
export type { Product, ProductStatus } from "../../../shared/dist/schemas/product.schema.js";
export type CondicaoEstado = z.infer<typeof CondicaoEstadoEnum>;
export type Imagem = z.infer<typeof ImagemSchema>;

/** Subconjunto de status que pode ser definido diretamente no cadastro manual (backend, `CreatableStatusEnum`). */
export const CreatableStatusEnum = z.enum(["rascunho", "em_revisao", "disponivel", "reservado"]);

export const PRODUCT_STATUS_LABELS: Record<z.infer<typeof ProductStatusEnum>, string> = {
  rascunho: "Rascunho",
  em_revisao: "Em revisão",
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
  inativo: "Inativo",
};

export const CONDICAO_ESTADO_LABELS: Record<CondicaoEstado, string> = {
  novo: "Novo",
  seminovo: "Seminovo",
  usado: "Usado",
};

/**
 * Formulário único (criação e edição — reaproveitado por 006). Campos "de lista" (estilo,
 * ocasião, defeitos etc.) usam um input de texto separado por vírgula em vez de um seletor de
 * tags dedicado — decisão de escopo do MVP do cadastro manual, documentada em tasks.md.
 */
export const ProductFormSchema = z
  .object({
    status: z.string().min(1),

    // Identificação
    nome: z.string().min(1, "Nome é obrigatório."),
    descricao: z.string().optional(),
    peca_unica: z.boolean().default(true),
    quantidade: z.coerce.number().int().min(1).default(1),

    // Classificação
    categoria_codigo: z.string().min(1, "Categoria é obrigatória."),
    subcategoria: z.string().optional(),
    estilo: z.string().optional(),
    ocasiao: z.string().optional(),
    estacao: z.string().optional(),

    // Marca
    marca_nome: z.string().optional(),
    marca_original: z.enum(["", "sim", "nao"]).default(""),

    // Características
    tamanho_etiqueta: z.string().optional(),
    tamanho_equivalente: z.string().optional(),
    genero: z.enum(["", "masculino", "feminino", "menino", "menina", "unissex"]).default(""),
    cor_principal: z.string().optional(),
    cores_secundarias: z.string().optional(),
    estampa: z.string().optional(),
    material: z.string().optional(),
    composicao: z.string().optional(),
    lavagem: z.string().optional(),
    modelagem: z.string().optional(),
    elasticidade: z.string().optional(),
    fechamento: z.string().optional(),

    // Medidas
    unidade: MedidasUnidadeEnum.default("cm"),
    cintura: z.string().optional(),
    quadril: z.string().optional(),
    gancho: z.string().optional(),
    comprimento: z.string().optional(),
    largura_barra: z.string().optional(),
    coxa: z.string().optional(),
    entrepasso: z.string().optional(),
    busto: z.string().optional(),
    largura_ombro: z.string().optional(),
    comprimento_manga: z.string().optional(),

    // Peso (sempre em kg — spec, seção 19)
    peso: z.string().optional(),

    // Condição
    estado: CondicaoEstadoEnum,
    nota: z.string().optional(),
    possui_etiqueta: z.boolean().default(false),
    possui_defeitos: z.boolean().default(false),
    defeitos: z.string().optional(),
    observacoes_condicao: z.string().optional(),

    // Preço
    moeda: MoedaEnum.default("BRL"),
    preco_original_estimado: z.string().optional(),
    custo_aquisicao: z.string().optional(),
    preco_venda: z.string().optional(),
    preco_promocional: z.string().optional(),

    // Estoque
    estoque_quantidade: z.coerce.number().int().min(0).default(1),
    setor: z.string().optional(),
    arara: z.string().optional(),
    posicao: z.string().optional(),

    // E-commerce
    slug: z.string().optional(),
    titulo_seo: z.string().optional(),
    tags: z.string().optional(),
    publicado: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.possui_defeitos && !data.defeitos?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defeitos"],
        message: "Descreva ao menos um defeito (separado por vírgula) quando marcar \"possui defeitos\".",
      });
    }
    for (const field of PRICE_FIELDS) {
      const value = data[field]?.trim();
      if (value && !DECIMAL_INPUT_PATTERN.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "Use só números, com vírgula ou ponto pra decimais (ex.: 19,90).",
        });
      }
    }
    const peso = data.peso?.trim();
    if (peso && !WEIGHT_INPUT_PATTERN.test(peso)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["peso"],
        message: "Use só números, com vírgula ou ponto pra decimais (ex.: 0,350).",
      });
    }
  });
export type ProductFormValues = z.infer<typeof ProductFormSchema>;

/** Aceita "19", "19.90" ou "19,90" — nunca mais de 2 casas decimais. */
const DECIMAL_INPUT_PATTERN = /^\d+([.,]\d{1,2})?$/;
const PRICE_FIELDS = [
  "preco_original_estimado",
  "custo_aquisicao",
  "preco_venda",
  "preco_promocional",
] as const;

/** Peso aceita até 3 casas decimais (precisão de grama — ex.: "0,350" para 350g), diferente
 * dos campos de preço (2 casas). */
const WEIGHT_INPUT_PATTERN = /^\d+([.,]\d{1,3})?$/;

/** Aceita tanto "19.90" quanto "19,90" (convenção brasileira) — sem isso, `Number("19,90")`
 * retorna `NaN` e o valor digitado é descartado silenciosamente (bug real de cadastro). */
function parseOptionalNumber(value?: string): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseList(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function textOrUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Converte o formulário plano em um payload no formato aninhado esperado pela API
 * (`CreateProductInput`/`UpdateProductInput`). `galeria` já reflete o estado pós upload/
 * remoção (o `ImageUploader` fala direto com `/api/images` antes do submit — ver 007) — a
 * primeira foto da galeria é sempre a principal, sem seletor dedicado (decisão de escopo).
 */
export function toProductPayload(values: ProductFormValues, galeria: Imagem[] = []) {
  return {
    status: values.status,
    imagens: { principal: galeria[0] ?? null, galeria },
    identificacao: {
      nome: values.nome,
      descricao: textOrUndefined(values.descricao),
      peca_unica: values.peca_unica,
      quantidade: values.quantidade,
    },
    classificacao: {
      categoria_codigo: values.categoria_codigo,
      subcategoria: textOrUndefined(values.subcategoria),
      estilo: parseList(values.estilo),
      ocasiao: parseList(values.ocasiao),
      estacao: parseList(values.estacao),
    },
    marca: {
      nome: textOrUndefined(values.marca_nome),
      original: values.marca_original === "" ? undefined : values.marca_original === "sim",
    },
    caracteristicas: {
      tamanho_etiqueta: textOrUndefined(values.tamanho_etiqueta),
      tamanho_equivalente: textOrUndefined(values.tamanho_equivalente),
      genero: values.genero === "" ? undefined : values.genero,
      cor_principal: textOrUndefined(values.cor_principal),
      cores_secundarias: parseList(values.cores_secundarias),
      estampa: textOrUndefined(values.estampa),
      material: parseList(values.material),
      composicao: textOrUndefined(values.composicao),
      lavagem: textOrUndefined(values.lavagem),
      modelagem: textOrUndefined(values.modelagem),
      elasticidade: textOrUndefined(values.elasticidade),
      fechamento: parseList(values.fechamento),
    },
    medidas: {
      unidade: values.unidade,
      cintura: parseOptionalNumber(values.cintura),
      quadril: parseOptionalNumber(values.quadril),
      gancho: parseOptionalNumber(values.gancho),
      comprimento: parseOptionalNumber(values.comprimento),
      largura_barra: parseOptionalNumber(values.largura_barra),
      coxa: parseOptionalNumber(values.coxa),
      entrepasso: parseOptionalNumber(values.entrepasso),
      busto: parseOptionalNumber(values.busto),
      largura_ombro: parseOptionalNumber(values.largura_ombro),
      comprimento_manga: parseOptionalNumber(values.comprimento_manga),
    },
    peso: {
      valor: parseOptionalNumber(values.peso),
      unidade: "kg" as const,
    },
    condicao: {
      estado: values.estado,
      nota: parseOptionalNumber(values.nota),
      possui_etiqueta: values.possui_etiqueta,
      possui_defeitos: values.possui_defeitos,
      defeitos: parseList(values.defeitos),
      observacoes: textOrUndefined(values.observacoes_condicao),
    },
    preco: {
      moeda: values.moeda,
      preco_original_estimado: parseOptionalNumber(values.preco_original_estimado),
      custo_aquisicao: parseOptionalNumber(values.custo_aquisicao),
      preco_venda: parseOptionalNumber(values.preco_venda),
      preco_promocional: parseOptionalNumber(values.preco_promocional),
    },
    estoque: {
      quantidade: values.estoque_quantidade,
      localizacao: {
        loja: "Loja Principal",
        setor: textOrUndefined(values.setor),
        arara: textOrUndefined(values.arara),
        posicao: textOrUndefined(values.posicao),
      },
    },
    ecommerce: {
      publicado: values.publicado,
      slug: textOrUndefined(values.slug),
      titulo_seo: textOrUndefined(values.titulo_seo),
      tags: parseList(values.tags),
    },
  };
}

/** Preenche o formulário a partir de um produto existente (edição). */
export function productToFormValues(product: z.infer<typeof ProductSchema>): ProductFormValues {
  const joinList = (list: string[]) => list.join(", ");
  return {
    status: product.status,
    nome: product.identificacao.nome,
    descricao: product.identificacao.descricao ?? "",
    peca_unica: product.identificacao.peca_unica,
    quantidade: product.identificacao.quantidade,
    categoria_codigo: product.classificacao.categoria_codigo,
    subcategoria: product.classificacao.subcategoria ?? "",
    estilo: joinList(product.classificacao.estilo),
    ocasiao: joinList(product.classificacao.ocasiao),
    estacao: joinList(product.classificacao.estacao),
    marca_nome: product.marca.nome ?? "",
    marca_original: product.marca.original === null ? "" : product.marca.original ? "sim" : "nao",
    tamanho_etiqueta: product.caracteristicas.tamanho_etiqueta ?? "",
    tamanho_equivalente: product.caracteristicas.tamanho_equivalente ?? "",
    genero: product.caracteristicas.genero ?? "",
    cor_principal: product.caracteristicas.cor_principal ?? "",
    cores_secundarias: joinList(product.caracteristicas.cores_secundarias),
    estampa: product.caracteristicas.estampa ?? "",
    material: joinList(product.caracteristicas.material),
    composicao: product.caracteristicas.composicao ?? "",
    lavagem: product.caracteristicas.lavagem ?? "",
    modelagem: product.caracteristicas.modelagem ?? "",
    elasticidade: product.caracteristicas.elasticidade ?? "",
    fechamento: joinList(product.caracteristicas.fechamento),
    unidade: product.medidas.unidade,
    cintura: product.medidas.cintura?.toString() ?? "",
    quadril: product.medidas.quadril?.toString() ?? "",
    gancho: product.medidas.gancho?.toString() ?? "",
    comprimento: product.medidas.comprimento?.toString() ?? "",
    largura_barra: product.medidas.largura_barra?.toString() ?? "",
    coxa: product.medidas.coxa?.toString() ?? "",
    entrepasso: product.medidas.entrepasso?.toString() ?? "",
    busto: product.medidas.busto?.toString() ?? "",
    largura_ombro: product.medidas.largura_ombro?.toString() ?? "",
    comprimento_manga: product.medidas.comprimento_manga?.toString() ?? "",
    peso: product.peso.valor?.toString() ?? "",
    estado: product.condicao.estado,
    nota: product.condicao.nota?.toString() ?? "",
    possui_etiqueta: product.condicao.possui_etiqueta,
    possui_defeitos: product.condicao.possui_defeitos,
    defeitos: joinList(product.condicao.defeitos),
    observacoes_condicao: product.condicao.observacoes ?? "",
    moeda: product.preco.moeda,
    preco_original_estimado: product.preco.preco_original_estimado?.toString() ?? "",
    custo_aquisicao: product.preco.custo_aquisicao?.toString() ?? "",
    preco_venda: product.preco.preco_venda?.toString() ?? "",
    preco_promocional: product.preco.preco_promocional?.toString() ?? "",
    estoque_quantidade: product.estoque.quantidade,
    setor: product.estoque.localizacao.setor ?? "",
    arara: product.estoque.localizacao.arara ?? "",
    posicao: product.estoque.localizacao.posicao ?? "",
    slug: product.ecommerce.slug ?? "",
    titulo_seo: product.ecommerce.titulo_seo ?? "",
    tags: joinList(product.ecommerce.tags),
    publicado: product.ecommerce.publicado,
  };
}

/** Valores iniciais do formulário de cadastro (todo campo opcional em branco). */
export const DEFAULT_PRODUCT_FORM_VALUES: ProductFormValues = {
  status: "rascunho",
  nome: "",
  descricao: "",
  peca_unica: true,
  quantidade: 1,
  categoria_codigo: "",
  subcategoria: "",
  estilo: "",
  ocasiao: "",
  estacao: "",
  marca_nome: "",
  marca_original: "",
  tamanho_etiqueta: "",
  tamanho_equivalente: "",
  genero: "",
  cor_principal: "",
  cores_secundarias: "",
  estampa: "",
  material: "",
  composicao: "",
  lavagem: "",
  modelagem: "",
  elasticidade: "",
  fechamento: "",
  unidade: "cm",
  cintura: "",
  quadril: "",
  gancho: "",
  comprimento: "",
  largura_barra: "",
  coxa: "",
  entrepasso: "",
  busto: "",
  largura_ombro: "",
  comprimento_manga: "",
  peso: "",
  estado: "novo",
  nota: "",
  possui_etiqueta: false,
  possui_defeitos: false,
  defeitos: "",
  observacoes_condicao: "",
  moeda: "BRL",
  preco_original_estimado: "",
  custo_aquisicao: "",
  preco_venda: "",
  preco_promocional: "",
  estoque_quantidade: 1,
  setor: "",
  arara: "",
  posicao: "",
  slug: "",
  titulo_seo: "",
  tags: "",
  publicado: false,
};

export const ListProductsFilterSchema = z.object({
  search: z.string().optional(),
  categoria_codigo: z.string().optional(),
  status: z.string().optional(),
  tamanho: z.string().optional(),
  cor: z.string().optional(),
  estado: z.string().optional(),
  preco_min: z.string().optional(),
  preco_max: z.string().optional(),
  page: z.number().int().min(1).default(1),
});
export type ListProductsFilterValues = z.infer<typeof ListProductsFilterSchema>;
