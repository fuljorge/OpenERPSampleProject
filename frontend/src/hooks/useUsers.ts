import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EditUserFormValues, User } from "../schemas/user.schema";
import { userService, type CreateUserPayload } from "../services/user.service";

export const USERS_QUERY_KEY = ["users"] as const;

export function useUsers(search?: string) {
  return useQuery({
    queryKey: [...USERS_QUERY_KEY, "list", search ?? ""],
    queryFn: () => userService.list(search),
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: [...USERS_QUERY_KEY, "detail", id],
    queryFn: () => userService.getById(id as string),
    enabled: id !== undefined,
  });
}

export function useUserMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });

  const create = useMutation({
    mutationFn: (payload: CreateUserPayload) => userService.create(payload),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: EditUserFormValues }) =>
      userService.update(id, values),
    onSuccess: invalidate,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: User["status"] }) =>
      userService.updateStatus(id, status),
    onSuccess: invalidate,
  });

  return { create, update, updateStatus };
}
