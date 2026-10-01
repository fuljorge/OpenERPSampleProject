import { z } from "zod";
import { AiFieldConfidenceSchema, CondicaoEstadoEnum, GeneroEnum, MedidasUnidadeEnum } from "./product.schema.js";

/**
 * Contrato de saída da IA (specs/006-produtos-cadastro-ia/spec.md, seções 5 e 8) — fonte
 * única de verdade, consumida por backend (validação real da resposta do modelo) e frontend
 * (tipagem + parse defensivo da resposta de `/api/products/analyze`, badges de confiança).
 * Subset **nullable** de `product.schema.ts` — nunca inclui `sku`, `preco`, `status`,
 * `estoque`, `ecommerce` nem `venda` (spec, seção 8.2-C: esses campos não existem aqui, então
 * não há como uma instrução maliciosa "vazar" para eles). **Todo objeto é `.strict()`** (spec,
 * seção 8.2-B): qualquer chave fora do schema rejeita a resposta inteira — nunca é descartada
 * em silêncio. `classificacao` não tem `categoria`/`departamento` (mesmo motivo de
 * `CreateClassificacaoSchema` em `product.schema.ts`, 005): são sempre derivados no backend a
 * partir de `categoria_codigo` validado, nunca aceitos de uma fonte externa — IA incluída.
 */

const nullableString = () => z.string().nullable();
const nullableNumber = () => z.number().nullable();
const stringArray = () => z.array(z.string()).default([]);

const AiIdentificacaoSchema = z
  .object({
    nome: nullableString(),
    descricao: nullableString(),
  })
  .strict();

const AiClassificacaoSchema = z
  .object({
    categoria_codigo: nullableString(),
    subcategoria: nullableString(),
    estilo: stringArray(),
    ocasiao: stringArray(),
    estacao: stringArray(),
  })
  .strict();

const AiMarcaSchema = z
  .object({
    nome: nullableString(),
    original: z.boolean().nullable(),
  })
  .strict();

const AiCaracteristicasSchema = z
  .object({
    tamanho_etiqueta: nullableString(),
    tamanho_equivalente: nullableString(),
    // Gênero da peça (spec 005; T060/decisão do usuário, 23/09/2026) — mesmo enum fechado do
    // cadastro manual, `null` quando a IA não consegue determinar (nunca inventa um dos 5
    // valores). Distinto de `classificacao.departamento`, que não existe aqui (é derivado da
    // categoria no backend, nunca aceito de fonte externa — ver comentário do arquivo).
    genero: GeneroEnum.nullable(),
    cor_principal: nullableString(),
    cores_secundarias: stringArray(),
    estampa: nullableString(),
    material: stringArray(),
    composicao: nullableString(),
    lavagem: nullableString(),
    modelagem: nullableString(),
    elasticidade: nullableString(),
    fechamento: stringArray(),
  })
  .strict();

const AiMedidasSchema = z
  .object({
    unidade: MedidasUnidadeEnum.default("cm"),
    cintura: nullableNumber(),
    quadril: nullableNumber(),
    gancho: nullableNumber(),
    comprimento: nullableNumber(),
    largura_barra: nullableNumber(),
    coxa: nullableNumber(),
    entrepasso: nullableNumber(),
    // Busto (spec 005; T060, 23/09/2026) — mesmo padrão dos irmãos acima: chave obrigatória
    // (o prompt em ai-intake.service.ts sempre a inclui), valor `null` quando não determinável.
    busto: nullableNumber(),
    // Ombro e manga (spec 005/012, 24/09/2026) — mesmo padrão.
    largura_ombro: nullableNumber(),
    comprimento_manga: nullableNumber(),
  })
  .strict();

const AiCondicaoSchema = z
  .object({
    estado: CondicaoEstadoEnum.nullable(),
    nota: nullableNumber(),
    possui_etiqueta: z.boolean().nullable(),
    possui_defeitos: z.boolean().nullable(),
    defeitos: stringArray(),
    observacoes: nullableString(),
  })
  .strict();

/** Confiança por campo (spec, seção 7) — metadado de exibição apenas, nunca usado para
 * decidir validação/persistência (spec, "Regras de negócio"). */
const AiMetadataFieldsSchema = z
  .object({
    fields: z.record(AiFieldConfidenceSchema).default({}),
  })
  .strict()
  .default({ fields: {} });

export const AiSuggestedProductSchema = z
  .object({
    identificacao: AiIdentificacaoSchema,
    classificacao: AiClassificacaoSchema,
    marca: AiMarcaSchema,
    caracteristicas: AiCaracteristicasSchema,
    medidas: AiMedidasSchema,
    condicao: AiCondicaoSchema,
    ai_metadata: AiMetadataFieldsSchema,
  })
  .strict();
export type AiSuggestedProduct = z.infer<typeof AiSuggestedProductSchema>;
