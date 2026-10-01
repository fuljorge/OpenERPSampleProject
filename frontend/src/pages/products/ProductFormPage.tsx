import { Link, useNavigate, useParams } from "react-router-dom";
import { ProductForm } from "../../features/products/ProductForm";
import { PublishToMarketplace } from "../../features/products/PublishToMarketplace";
import { useProduct } from "../../hooks/useProduct";
import { useProductMutations } from "../../hooks/useProducts";
import {
  DEFAULT_PRODUCT_FORM_VALUES,
  productToFormValues,
  toProductPayload,
  type Imagem,
  type ProductFormValues,
} from "../../schemas/product.schema";

export function ProductFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { create, update } = useProductMutations();

  if (id) {
    return <EditProductSection id={id} update={update} />;
  }

  async function handleCreate(values: ProductFormValues, imagens: Imagem[]) {
    await create.mutateAsync(toProductPayload(values, imagens));
    navigate("/products");
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-bold text-wine-900">Novo produto</h1>
      <ProductForm
        mode="create"
        defaultValues={DEFAULT_PRODUCT_FORM_VALUES}
        onSubmit={handleCreate}
        isSubmitting={create.isPending}
      />
    </div>
  );
}

/**
 * Edição permanece na mesma tela depois de salvar — sem navegação automática pra listagem
 * (spec 005, seção 4.2; decisão do usuário, 24/09/2026). O link "Voltar para produtos" é a
 * única saída explícita, independente do botão de salvar.
 */
function EditProductSection({
  id,
  update,
}: {
  id: string;
  update: ReturnType<typeof useProductMutations>["update"];
}) {
  const { data: product, isLoading, isError } = useProduct(id);

  async function handleUpdate(values: ProductFormValues, imagens: Imagem[]) {
    await update.mutateAsync({ id, payload: toProductPayload(values, imagens) });
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-wine-900">Editar produto</h1>
        <Link to="/products" className="text-sm font-medium text-wine-700 hover:text-wine-900">
          ← Voltar para produtos
        </Link>
      </div>
      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Produto não encontrado.</p>}
      {product && (
        <>
          <PublishToMarketplace product={product} />
          <ProductForm
            mode="edit"
            productId={id}
            defaultValues={productToFormValues(product)}
            defaultImages={product.imagens.galeria}
            onSubmit={handleUpdate}
            isSubmitting={update.isPending}
          />
        </>
      )}
    </div>
  );
}
