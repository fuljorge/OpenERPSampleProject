import { z } from "zod";
import {
  AiMetadataSchema,
  CaracteristicasSchema,
  ClassificacaoSchema,
  CondicaoBaseSchema,
  CondicaoSchema,
  EcommerceSchema,
  EstoqueSchema,
  IdentificacaoSchema,
  ImagensSchema,
  MarcaSchema,
  MedidasSchema,
  PesoSchema,
  PrecoSchema,
  ProductSchema,
  ProductStatusEnum,
  VendaSchema,
} from "../../../shared/dist/schemas/product.schema.js";

export { ProductSchema, ProductStatusEnum };
export type {
  Product,
  ProductStatus,
} from "../../../shared/dist/schemas/product.schema.js";

/**
 * Subconjunto de status que pode ser definido diretamente na criação — `vendido` e
 * `inativo` exigem uma ação dedicada (marcar como vendido via `PATCH .../status`, desativar),
 * nunca criação direta com esse valor.
 */
const CreatableStatusEnum = z.enum(["rascunho", "em_revisao", "disponivel", "reservado"]);

const CreateIdentificacaoSchema = IdentificacaoSchema.omit({ data_cadastro: true });
const CreateClassificacaoSchema = ClassificacaoSchema.omit({ categoria: true, departamento: true });

export const CreateProductSchema = z.object({
  status: CreatableStatusEnum.default("rascunho"),
  identificacao: CreateIdentificacaoSchema,
  classificacao: CreateClassificacaoSchema,
  marca: MarcaSchema.optional(),
  caracteristicas: CaracteristicasSchema.optional(),
  medidas: MedidasSchema.optional(),
  peso: PesoSchema.optional(),
  condicao: CondicaoSchema,
  preco: PrecoSchema.optional(),
  estoque: EstoqueSchema.optional(),
  imagens: ImagensSchema.optional(),
  ecommerce: EcommerceSchema.optional(),
  // Preenchido só pelo fluxo de 006 (POST /products/confirm) — ausente no cadastro manual
  // (005), onde `createProduct` usa o default `{generated: false, ...}` do schema.
  ai_metadata: AiMetadataSchema.optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

/**
 * PATCH aceita qualquer subconjunto de campos, em qualquer profundidade — o repository
 * aplica via `$set` em dot-notation, então campos omitidos nunca são tocados (diferente de
 * substituir a subseção inteira, que apagaria os irmãos não enviados). A regra condicional de
 * `condicao` (possui_defeitos ⇒ defeitos) não é reforçada em updates parciais — só na criação.
 */
export const UpdateProductSchema = z
  .object({
    status: ProductStatusEnum.optional(),
    identificacao: CreateIdentificacaoSchema.partial().optional(),
    classificacao: CreateClassificacaoSchema.partial().optional(),
    marca: MarcaSchema.partial().optional(),
    caracteristicas: CaracteristicasSchema.partial().optional(),
    medidas: MedidasSchema.partial().optional(),
    peso: PesoSchema.partial().optional(),
    condicao: CondicaoBaseSchema.partial().optional(),
    preco: PrecoSchema.partial().optional(),
    estoque: EstoqueSchema.partial().optional(),
    // Não é `.partial()`: fotos são gerenciadas como o array completo resultante (o cliente
    // já fez upload/remoção via /api/images antes do PATCH — ver 007) — sempre um replace
    // atômico de `imagens`, nunca um merge campo a campo como as demais subseções.
    imagens: ImagensSchema.optional(),
    ecommerce: EcommerceSchema.partial().optional(),
    venda: VendaSchema.partial().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

export const ListProductsQuerySchema = z.object({
  search: z.string().optional(), // nome ou sku
  categoria_codigo: z.string().optional(),
  subcategoria: z.string().optional(),
  departamento: z.string().optional(),
  marca: z.string().optional(),
  tamanho: z.string().optional(),
  cor: z.string().optional(),
  estado: z.string().optional(),
  status: ProductStatusEnum.optional(),
  preco_min: z.coerce.number().optional(),
  preco_max: z.coerce.number().optional(),
  cadastrado_de: z.coerce.date().optional(),
  cadastrado_ate: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListProductsQuery = z.infer<typeof ListProductsQuerySchema>;
