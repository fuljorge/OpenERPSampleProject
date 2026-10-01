import { Link, useParams } from "react-router-dom";
import { ProductForm } from "../../features/products/ProductForm";
import { useProduct } from "../../hooks/useProduct";
import { productToFormValues } from "../../schemas/product.schema";

/**
 * Abre um produto em modo somente leitura (spec 005, seção 5: "visualização" já listada como
 * ação da tela de Produtos, nunca implementada até agora). Reaproveita o `ProductForm` (mesmo
 * espírito de 006, que já o reaproveita para revisão) travado via `mode="view"` — nenhum
 * campo é editável, sem botão de salvar. Rota separada de `/products/:id` (edição): liberada a
 * qualquer perfil autenticado, inclusive `viewer`, que hoje não tem nenhuma forma de abrir o
 * detalhe de um produto (só a listagem).
 */
export function ProductViewPage() {
  const { id } = useParams<{ id: string }>();
  const { data: product, isLoading, isError } = useProduct(id);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-wine-900">Visualizar produto</h1>
        <Link to="/products" className="text-sm text-wine-700 hover:underline">
          Voltar
        </Link>
      </div>
      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Produto não encontrado.</p>}
      {product && (
        <ProductForm
          mode="view"
          defaultValues={productToFormValues(product)}
          defaultImages={product.imagens.galeria}
          onSubmit={async () => {}}
          isSubmitting={false}
        />
      )}
    </div>
  );
}
