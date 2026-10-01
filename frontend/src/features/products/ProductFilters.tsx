import { useCategories } from "../../hooks/useCategories";
import { PRODUCT_STATUS_LABELS, ProductStatusEnum } from "../../schemas/product.schema";

const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600";

export interface ProductFiltersValues {
  categoria_codigo?: string;
  status?: string;
  tamanho?: string;
  cor?: string;
  estado?: string;
  preco_min?: string;
  preco_max?: string;
}

interface ProductFiltersProps {
  values: ProductFiltersValues;
  onChange: (values: ProductFiltersValues) => void;
}

/** Painel de filtros combinados da listagem de produtos (spec 005, seção 5). */
export function ProductFilters({ values, onChange }: ProductFiltersProps) {
  const { data: categories } = useCategories(true);

  function set<K extends keyof ProductFiltersValues>(key: K, value: string) {
    onChange({ ...values, [key]: value || undefined });
  }

  return (
    <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <select
        className={inputClass}
        value={values.categoria_codigo ?? ""}
        onChange={(e) => set("categoria_codigo", e.target.value)}
      >
        <option value="">Todas as categorias</option>
        {categories?.map((category) => (
          <option key={category.id} value={category.code}>
            {category.name}
          </option>
        ))}
      </select>

      <select className={inputClass} value={values.status ?? ""} onChange={(e) => set("status", e.target.value)}>
        <option value="">Todos os status</option>
        {ProductStatusEnum.options.map((status) => (
          <option key={status} value={status}>
            {PRODUCT_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <input
        className={`${inputClass} w-28`}
        placeholder="Tamanho"
        value={values.tamanho ?? ""}
        onChange={(e) => set("tamanho", e.target.value)}
      />
      <input
        className={`${inputClass} w-28`}
        placeholder="Cor"
        value={values.cor ?? ""}
        onChange={(e) => set("cor", e.target.value)}
      />
      <select className={inputClass} value={values.estado ?? ""} onChange={(e) => set("estado", e.target.value)}>
        <option value="">Todos os estados</option>
        <option value="novo">Novo</option>
        <option value="seminovo">Seminovo</option>
        <option value="usado">Usado</option>
      </select>
      <input
        className={`${inputClass} w-28`}
        type="number"
        placeholder="Preço mín."
        value={values.preco_min ?? ""}
        onChange={(e) => set("preco_min", e.target.value)}
      />
      <input
        className={`${inputClass} w-28`}
        type="number"
        placeholder="Preço máx."
        value={values.preco_max ?? ""}
        onChange={(e) => set("preco_max", e.target.value)}
      />

      <button
        type="button"
        className="text-sm text-gray-500 hover:underline"
        onClick={() => onChange({})}
      >
        Limpar filtros
      </button>
    </div>
  );
}
