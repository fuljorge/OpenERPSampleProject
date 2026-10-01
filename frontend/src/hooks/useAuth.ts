import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthUser, LoginFormValues } from "../schemas/auth.schema";
import { authService } from "../services/auth.service";

export const AUTH_QUERY_KEY = ["auth", "me"] as const;

/**
 * Estado de sessão do usuário logado, via `GET /me` (TanStack Query). `user` é `null` tanto
 * durante o carregamento inicial quanto quando não há sessão válida — use `isLoading` para
 * distinguir os dois casos na UI.
 */
export function useAuth() {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: authService.me,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: (values: LoginFormValues) => authService.login(values),
    onSuccess: (user: AuthUser) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, user);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: authService.logout,
    onSuccess: () => {
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
    },
  });

  return {
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
    login: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    logout: logoutMutation.mutateAsync,
    isLoggingOut: logoutMutation.isPending,
  };
}
