import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateMarketplaceAccountFormValues,
  EditMarketplaceAccountFormValues,
  Marketplace,
  MarketplaceAccount,
  MercadoLivrePackageSettingsFormValues,
} from "../schemas/marketplace-account.schema";
import { marketplaceAccountService } from "../services/marketplace-account.service";

export const MARKETPLACE_ACCOUNTS_QUERY_KEY = ["marketplace-accounts"] as const;

export function useMarketplaceAccounts(filter: { marketplace?: Marketplace; active?: boolean } = {}) {
  return useQuery({
    queryKey: [...MARKETPLACE_ACCOUNTS_QUERY_KEY, filter.marketplace ?? "all", filter.active ?? "all"],
    queryFn: () => marketplaceAccountService.list(filter),
  });
}

export const ENCRYPTION_KEY_QUERY_KEY = ["marketplace-accounts", "encryption-key"] as const;

export function useEncryptionKeyStatus() {
  return useQuery({
    queryKey: ENCRYPTION_KEY_QUERY_KEY,
    queryFn: () => marketplaceAccountService.getEncryptionKeyStatus(),
  });
}

export function useRotateEncryptionKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => marketplaceAccountService.rotateEncryptionKey(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MARKETPLACE_ACCOUNTS_QUERY_KEY }),
  });
}

export const MERCADO_LIVRE_PACKAGE_SETTINGS_QUERY_KEY = ["marketplace-accounts", "mercado-livre-package-settings"] as const;

export function useMercadoLivrePackageSettings() {
  return useQuery({
    queryKey: MERCADO_LIVRE_PACKAGE_SETTINGS_QUERY_KEY,
    queryFn: () => marketplaceAccountService.getMercadoLivrePackageSettings(),
  });
}

export function useUpdateMercadoLivrePackageSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: MercadoLivrePackageSettingsFormValues) => marketplaceAccountService.updateMercadoLivrePackageSettings(values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MERCADO_LIVRE_PACKAGE_SETTINGS_QUERY_KEY }),
  });
}

export function useOAuthRedirectUri() {
  return useQuery({
    queryKey: ["marketplace-accounts", "oauth-redirect-uri"],
    queryFn: () => marketplaceAccountService.getOAuthRedirectUri(),
    staleTime: Infinity,
  });
}

export function useMarketplaceAccountMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MARKETPLACE_ACCOUNTS_QUERY_KEY });

  const create = useMutation({
    mutationFn: (payload: CreateMarketplaceAccountFormValues) => marketplaceAccountService.create(payload),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: EditMarketplaceAccountFormValues }) =>
      marketplaceAccountService.update(id, values),
    onSuccess: invalidate,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, active }: { id: string; active: MarketplaceAccount["active"] }) =>
      marketplaceAccountService.updateStatus(id, active),
    onSuccess: invalidate,
  });

  // Devolve a URL do Mercado Livre; quem chama redireciona o navegador (a troca do code por
  // tokens acontece no backend, ao voltar — ver OAuthCallbackPage).
  const startOAuth = useMutation({
    mutationFn: (id: string) => marketplaceAccountService.startOAuthAuthorization(id),
    onSuccess: invalidate,
  });

  const completeOAuth = useMutation({
    mutationFn: (input: { code: string; state: string }) => marketplaceAccountService.completeOAuthAuthorization(input),
    onSuccess: invalidate,
  });

  // Não grava nada, então não invalida a lista de contas.
  const testIntegration = useMutation({
    mutationFn: (input: { clientId: string; clientSecret: string }) =>
      marketplaceAccountService.testMercadoLivreIntegration(input),
  });

  // Ciclo de remoção (spec 011, seção 2.2.2). A lista e o cartão da chave de criptografia
  // (contas por chave) compartilham o prefixo da query key, então um invalidate atualiza os dois.
  const disconnect = useMutation({
    mutationFn: (id: string) => marketplaceAccountService.disconnect(id),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => marketplaceAccountService.remove(id),
    onSuccess: invalidate,
  });

  return { create, update, updateStatus, startOAuth, completeOAuth, testIntegration, disconnect, remove };
}
