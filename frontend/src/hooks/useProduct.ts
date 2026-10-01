import { useQuery } from "@tanstack/react-query";
import { productService } from "../services/product.service";
import { PRODUCTS_QUERY_KEY } from "./useProducts";

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: [...PRODUCTS_QUERY_KEY, "detail", id],
    queryFn: () => productService.getById(id as string),
    enabled: id !== undefined,
  });
}
