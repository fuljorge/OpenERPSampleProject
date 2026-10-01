import { useState } from "react";
import { Link } from "react-router-dom";
import { Pagination } from "../../components/Pagination";
import { ProductCard } from "../../components/ProductCard";
import { SearchInput } from "../../components/SearchInput";
import { Table, type TableColumn } from "../../components/Table";
import { ProductFilters, type ProductFiltersValues } from "../../features/products/ProductFilters";
import { useAuth } from "../../hooks/useAuth";
import { useProductMutations, useProducts } from "../../hooks/useProducts";
import type { Product } from "../../schemas/product.schema";

export function ProductsPage() {
  const { user } = useAuth();
  const canWrite = user?.role === "admin" || user?.role === "operator";
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ProductFiltersValues>({});
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useProducts({ search: search || undefined, ...filters, page, limit: 20 });
  const { softDelete, markAsSold } = useProductMutations();
  const [actionError, setActionError] = useState<string | null>(null);

  function updateFilters(next: ProductFiltersValues) {
    setFilters(next);
    setPage(1);
  }

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function runAction(action: Promise<unknown>) {
    setActionError(null);
    action.catch((err) => setActionError(err instanceof Error ? err.message : "Não foi possível concluir a ação."));
  }

  const columns: TableColumn<Product>[] = [
    { key: "product", header: "Produto", render: (p) => <ProductCard product={p} /> },
    {
      key: "actions",
      header: "Ações",
      render: (p) => (
        <div className="flex flex-col items-start gap-1">
          <Link className="text-sm text-wine-700 hover:underline" to={`/products/${p.id}/view`}>
            Visualizar
          </Link>
          {canWrite && (
            <Link className="text-sm text-wine-700 hover:underline" to={`/products/${p.id}`}>
              Editar
            </Link>
          )}
          {canWrite && (p.status === "disponivel" || p.status === "reservado") && (
            <button
              type="button"
              className="text-sm text-gray-600 hover:underline disabled:opacity-50"
              disabled={markAsSold.isPending}
              onClick={() => runAction(markAsSold.mutateAsync(p.id))}
            >
              Marcar como vendida
            </button>
          )}
          {user?.role === "admin" && p.status !== "inativo" && (
            <button
              type="button"
              className="text-sm text-gray-600 hover:underline disabled:opacity-50"
              disabled={softDelete.isPending}
              onClick={() => runAction(softDelete.mutateAsync(p.id))}
            >
              Desativar
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-wine-900">Produtos</h1>
        {canWrite && (
          <div className="flex gap-2">
            <Link
              className="rounded-md border border-wine-800 px-4 py-2 text-sm font-medium text-wine-800 hover:bg-wine-50"
              to="/products/ai-new"
            >
              + Cadastrar com IA
            </Link>
            <Link
              className="rounded-md bg-wine-800 px-4 py-2 text-sm font-medium text-gold-100 hover:bg-wine-900"
              to="/products/new"
            >
              + Novo produto
            </Link>
          </div>
        )}
      </div>

      <SearchInput value={search} onChange={updateSearch} placeholder="Buscar por nome ou SKU..." />
      <ProductFilters values={filters} onChange={updateFilters} />
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Não foi possível carregar os produtos.</p>}
      {data && (
        <>
          <Table columns={columns} rows={data.items} rowKey={(p) => p.id} emptyMessage="Nenhum produto encontrado." />
          <Pagination page={data.page} limit={data.limit} total={data.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
