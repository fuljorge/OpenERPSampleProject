import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ImageUploader } from "../../components/ImageUploader";
import { useCategories } from "../../hooks/useCategories";
import { useReanalyzeProduct } from "../../hooks/useAiAnalysis";
import { aiSuggestionToFormValues, type AiSuggestedProduct } from "../../schemas/ai-intake.schema";
import { AiConfidenceBadges } from "../products-ai/AiConfidenceBadges";
import {
  CONDICAO_ESTADO_LABELS,
  CondicaoEstadoEnum,
  CreatableStatusEnum,
  GENERO_LABELS,
  GeneroEnum,
  MOEDA_SYMBOLS,
  PRODUCT_STATUS_LABELS,
  ProductFormSchema,
  ProductStatusEnum,
  type Imagem,
  type ProductFormValues,
} from "../../schemas/product.schema";

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600";
const labelClass = "block text-sm font-medium text-gray-700";
const errorClass = "mt-1 text-sm text-red-600";
const buttonClass =
  "rounded-md bg-wine-800 px-4 py-2 text-sm font-medium text-gold-100 hover:bg-wine-900 disabled:opacity-50";
const sectionClass = "space-y-4 rounded-lg border border-gray-200 bg-white p-4";
const sectionTitleClass = "font-display text-base font-semibold text-wine-900";
const gridClass = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

interface ProductFormProps {
  mode: "create" | "edit" | "view";
  defaultValues: ProductFormValues;
  defaultImages?: Imagem[];
  /** Só presente no modo edição — habilita o botão "Reavaliar com IA" (spec 006, seção 9; 005,
   * seção 4.3). */
  productId?: string;
  onSubmit: (values: ProductFormValues, imagens: Imagem[]) => Promise<void>;
  isSubmitting: boolean;
}

/**
 * Formulário único de cadastro/edição manual de produto (spec 005, seção 2) — reaproveitado
 * por 006-produtos-cadastro-ia para revisão dos campos gerados pela IA. Campos "de lista"
 * (estilo, defeitos, tags etc.) usam texto separado por vírgula (ver product.schema.ts).
 */
export function ProductForm({ mode, defaultValues, defaultImages = [], productId, onSubmit, isSubmitting }: ProductFormProps) {
  const { data: categories } = useCategories(true);
  const [images, setImages] = useState<Imagem[]>(defaultImages);
  const [justSaved, setJustSaved] = useState(false);
  const [lastSuggestion, setLastSuggestion] = useState<AiSuggestedProduct | null>(null);
  const reanalyze = useReanalyzeProduct();
  const {
    register,
    handleSubmit,
    watch,
    setError,
    reset,
    getValues,
    formState: { errors, isDirty },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(ProductFormSchema),
    defaultValues,
  });

  const possuiDefeitos = watch("possui_defeitos");

  async function submit(values: ProductFormValues) {
    try {
      await onSubmit(values, images);
      // Edição permanece na mesma tela depois de salvar (005, seção 4.2) — limpa o estado
      // "dirty" sem trocar os valores exibidos e mostra a confirmação; some sozinha assim que
      // `isDirty` voltar a `true` (qualquer campo editado de novo), sem efeito/assinatura extra.
      reset(values);
      setJustSaved(true);
    } catch (err) {
      setError("root", { message: err instanceof Error ? err.message : "Não foi possível salvar." });
      setJustSaved(false);
    }
  }

  async function handleReanalyze() {
    if (!productId) return;
    setJustSaved(false);
    try {
      const suggestion = await reanalyze.mutateAsync(productId);
      reset(aiSuggestionToFormValues(suggestion, getValues()));
      setLastSuggestion(suggestion);
    } catch {
      // Erro já exposto via `reanalyze.error` abaixo — nada a fazer aqui.
    }
  }

  return (
    <form className="space-y-6" onSubmit={(e) => void handleSubmit(submit)(e)} noValidate>
      {/* `disabled` num <fieldset> cascateia pra todo controle descendente — inclusive os
          <fieldset> das seções abaixo, aninhados dentro deste (spec 005: modo "view" reaproveita
          o mesmo formulário de cadastro/edição, só travado). `contents` não interfere no layout
          (grid/spacing) das seções internas. */}
      <fieldset disabled={mode === "view"} className="contents">
      <fieldset className={sectionClass}>
        <legend className={sectionTitleClass}>Identificação</legend>
        <div className={gridClass}>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelClass}>
              Nome *
              <input className={inputClass} type="text" {...register("nome")} />
            </label>
            {errors.nome && <p className={errorClass}>{errors.nome.message}</p>}
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelClass}>
              Descrição
              <textarea className={inputClass} rows={2} {...register("descricao")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Status
              <select className={inputClass} {...register("status")}>
                {(mode === "create" ? CreatableStatusEnum.options : ProductStatusEnum.options).map((status) => (
                  <option key={status} value={status}>
                    {PRODUCT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Quantidade
              <input className={inputClass} type="number" min={1} {...register("quantidade")} />
            </label>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" {...register("peca_unica")} />
              Peça única
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className={sectionClass}>
        <legend className={sectionTitleClass}>Fotos</legend>
        <ImageUploader images={images} onChange={setImages} disabled={isSubmitting || mode === "view"} />

        {mode === "edit" && productId && (
          <div className="space-y-2 border-t border-gray-100 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={buttonClass}
                disabled={images.length === 0 || reanalyze.isPending}
                onClick={() => void handleReanalyze()}
              >
                {reanalyze.isPending ? "Reavaliando..." : "Reavaliar com IA"}
              </button>
              <p className="text-sm text-gray-500">
                Usa as fotos já salvas da peça — se você acabou de adicionar ou remover fotos, salve as
                alterações antes de reavaliar.
              </p>
            </div>
            {reanalyze.isError && (
              <p className={errorClass}>
                {reanalyze.error instanceof Error ? reanalyze.error.message : "Não foi possível reavaliar por IA."}
              </p>
            )}
            {lastSuggestion && <AiConfidenceBadges suggestion={lastSuggestion} />}
          </div>
        )}
      </fieldset>

      <fieldset className={sectionClass}>
        <legend className={sectionTitleClass}>Classificação</legend>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>
              Categoria *
              <select className={inputClass} {...register("categoria_codigo")}>
                <option value="">Selecione...</option>
                {categories?.map((category) => (
                  <option key={category.id} value={category.code}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            {errors.categoria_codigo && <p className={errorClass}>{errors.categoria_codigo.message}</p>}
          </div>
          <div>
            <label className={labelClass}>
              Subcategoria
              <input className={inputClass} type="text" {...register("subcategoria")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Estilo (separado por vírgula)
              <input className={inputClass} type="text" {...register("estilo")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Ocasião (separado por vírgula)
              <input className={inputClass} type="text" {...register("ocasiao")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Estação (separado por vírgula)
              <input className={inputClass} type="text" {...register("estacao")} />
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className={sectionClass}>
        <legend className={sectionTitleClass}>Marca</legend>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>
              Nome da marca
              <input className={inputClass} type="text" {...register("marca_nome")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              É original?
              <select className={inputClass} {...register("marca_original")}>
                <option value="">Não sei</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className={sectionClass}>
        <legend className={sectionTitleClass}>Características</legend>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>
              Tamanho na etiqueta
              <input className={inputClass} type="text" {...register("tamanho_etiqueta")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Tamanho equivalente
              <input className={inputClass} type="text" {...register("tamanho_equivalente")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Gênero
              <select className={inputClass} {...register("genero")}>
                <option value="">Não informado</option>
                {GeneroEnum.options.map((option) => (
                  <option key={option} value={option}>
                    {GENERO_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Cor principal
              <input className={inputClass} type="text" {...register("cor_principal")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Cores secundárias (vírgula)
              <input className={inputClass} type="text" {...register("cores_secundarias")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Estampa
              <input className={inputClass} type="text" {...register("estampa")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Material (vírgula)
              <input className={inputClass} type="text" {...register("material")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Composição
              <input className={inputClass} type="text" {...register("composicao")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Lavagem
              <input className={inputClass} type="text" {...register("lavagem")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Modelagem
              <input className={inputClass} type="text" {...register("modelagem")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Elasticidade
              <input className={inputClass} type="text" {...register("elasticidade")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Fechamento (vírgula)
              <input className={inputClass} type="text" {...register("fechamento")} />
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className={sectionClass}>
        <legend className={sectionTitleClass}>Medidas</legend>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>
              Unidade
              <select className={inputClass} {...register("unidade")}>
                <option value="cm">cm</option>
                <option value="in">in</option>
              </select>
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Cintura
              <input className={inputClass} type="number" step="0.1" {...register("cintura")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Quadril
              <input className={inputClass} type="number" step="0.1" {...register("quadril")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Gancho
              <input className={inputClass} type="number" step="0.1" {...register("gancho")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Comprimento
              <input className={inputClass} type="number" step="0.1" {...register("comprimento")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Largura da barra
              <input className={inputClass} type="number" step="0.1" {...register("largura_barra")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Coxa
              <input className={inputClass} type="number" step="0.1" {...register("coxa")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Entrepasso
              <input className={inputClass} type="number" step="0.1" {...register("entrepasso")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Busto
              <input className={inputClass} type="number" step="0.1" {...register("busto")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Largura do ombro
              <input className={inputClass} type="number" step="0.1" {...register("largura_ombro")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Comprimento da manga
              <input className={inputClass} type="number" step="0.1" {...register("comprimento_manga")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Peso (kg)
              <input className={inputClass} type="number" step="0.001" min="0" {...register("peso")} />
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className={sectionClass}>
        <legend className={sectionTitleClass}>Condição</legend>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>
              Estado *
              <select className={inputClass} {...register("estado")}>
                {CondicaoEstadoEnum.options.map((estado) => (
                  <option key={estado} value={estado}>
                    {CONDICAO_ESTADO_LABELS[estado]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Nota (0 a 10)
              <input className={inputClass} type="number" min={0} max={10} step="0.1" {...register("nota")} />
            </label>
          </div>
          <div className="flex items-end gap-4 pb-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" {...register("possui_etiqueta")} />
              Possui etiqueta
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" {...register("possui_defeitos")} />
              Possui defeitos
            </label>
          </div>
          {possuiDefeitos && (
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelClass}>
                Defeitos (separado por vírgula) *
                <input className={inputClass} type="text" {...register("defeitos")} />
              </label>
              {errors.defeitos && <p className={errorClass}>{errors.defeitos.message}</p>}
            </div>
          )}
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelClass}>
              Observações
              <textarea className={inputClass} rows={2} {...register("observacoes_condicao")} />
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className={sectionClass}>
        <legend className={sectionTitleClass}>Preço</legend>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>
              Moeda
              <select className={inputClass} {...register("moeda")}>
                {Object.entries(MOEDA_SYMBOLS).map(([code, symbol]) => (
                  <option key={code} value={code}>
                    {symbol} ({code})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Preço original estimado
              <input
                className={inputClass}
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                {...register("preco_original_estimado")}
              />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Custo de aquisição
              <input
                className={inputClass}
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                {...register("custo_aquisicao")}
              />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Preço de venda
              <input
                className={inputClass}
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                {...register("preco_venda")}
              />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Preço promocional
              <input
                className={inputClass}
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                {...register("preco_promocional")}
              />
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className={sectionClass}>
        <legend className={sectionTitleClass}>Estoque</legend>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>
              Quantidade em estoque
              <input className={inputClass} type="number" min={0} {...register("estoque_quantidade")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Setor
              <input className={inputClass} type="text" {...register("setor")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Arara
              <input className={inputClass} type="text" {...register("arara")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Posição
              <input className={inputClass} type="text" {...register("posicao")} />
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className={sectionClass}>
        <legend className={sectionTitleClass}>E-commerce</legend>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>
              Slug (URL)
              <input className={inputClass} type="text" {...register("slug")} placeholder="gerado a partir do nome" />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Título SEO
              <input className={inputClass} type="text" {...register("titulo_seo")} />
            </label>
          </div>
          <div>
            <label className={labelClass}>
              Tags (separado por vírgula)
              <input className={inputClass} type="text" {...register("tags")} />
            </label>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" {...register("publicado")} />
              Publicado no e-commerce
            </label>
          </div>
        </div>
      </fieldset>

      </fieldset>

      {errors.root?.message && <p className={errorClass}>{errors.root.message}</p>}

      {mode !== "view" && (
        <div className="flex items-center gap-3">
          <button type="submit" className={buttonClass} disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : mode === "create" ? "Cadastrar produto" : "Salvar alterações"}
          </button>
          {justSaved && !isDirty && (
            <p className="text-sm text-green-700" role="status">
              Alterações salvas.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
