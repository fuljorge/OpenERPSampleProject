import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, CreateCategoryFormValues, EditCategoryFormValues } from "../schemas/category.schema";
import { categoryService } from "../services/category.service";

export const CATEGORIES_QUERY_KEY = ["categories"] as const;

export function useCategories(active?: boolean) {
  return useQuery({
    queryKey: [...CATEGORIES_QUERY_KEY, active ?? "all"],
    queryFn: () => categoryService.list(active),
  });
}

export function useCategoryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });

  const create = useMutation({
    mutationFn: (payload: CreateCategoryFormValues) => categoryService.create(payload),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: EditCategoryFormValues }) =>
      categoryService.update(id, values),
    onSuccess: invalidate,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, active }: { id: string; active: Category["active"] }) =>
      categoryService.updateStatus(id, active),
    onSuccess: invalidate,
  });

  return { create, update, updateStatus };
}
