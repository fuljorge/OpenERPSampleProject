import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { productService, type ListProductsParams } from "../services/product.service";

export const PRODUCTS_QUERY_KEY = ["products"] as const;

export function useProducts(params: ListProductsParams) {
  return useQuery({
    queryKey: [...PRODUCTS_QUERY_KEY, "list", params],
    queryFn: () => productService.list(params),
  });
}

export function useProductMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });

  const create = useMutation({
    mutationFn: (payload: unknown) => productService.create(payload),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) => productService.update(id, payload),
    onSuccess: invalidate,
  });

  const softDelete = useMutation({
    mutationFn: (id: string) => productService.softDelete(id),
    onSuccess: invalidate,
  });

  /** Atalho para a ação "marcar como vendida" (PATCH status=vendido) — spec 005, seção 3. */
  const markAsSold = useMutation({
    mutationFn: (id: string) => productService.update(id, { status: "vendido" }),
    onSuccess: invalidate,
  });

  return { create, update, softDelete, markAsSold };
}
