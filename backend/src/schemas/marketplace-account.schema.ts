import { z } from "zod";
import { MarketplaceEnum } from "../../../shared/dist/schemas/marketplace.schema.js";

export { MarketplaceEnum };
export type { Marketplace } from "../../../shared/dist/schemas/marketplace.schema.js";

export const ConnectionStatusEnum = z.enum(["connected", "disconnected", "error", "expired"]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusEnum>;

/**
 * Resposta de API (spec 011, seção 2.2) — **nunca** contém o valor completo de `credential`,
 * em nenhum perfil, em nenhuma rota. `credentialPreview` é calculado no momento em que a
 * credencial é salva (`marketplace-account.service.ts`), nunca derivado de uma decriptação
 * sob demanda.
 */
export const MarketplaceAccountSchema = z.object({
  id: z.string(),
  marketplace: MarketplaceEnum,
  label: z.string(),
  credentialPreview: z.string(),
  connectionStatus: ConnectionStatusEnum,
  active: z.boolean(),
  /** Anúncios `publicado` que usam esta conta (spec 011, seção 2.2.2) — só informativo, não bloqueia. */
  publishedListingsCount: z.number().int().nonnegative(),
  /** Usuário do Mercado Livre esperado (apelido ou ID) e quem de fato autorizou — spec 012, seção 2.5. */
  expectedUser: z.string().nullable(),
  connectedNickname: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MarketplaceAccount = z.infer<typeof MarketplaceAccountSchema>;

export const CreateMarketplaceAccountSchema = z.object({
  marketplace: MarketplaceEnum,
  label: z.string().min(1, "Apelido da conta é obrigatório."),
  credential: z.string().min(1, "Credencial é obrigatória."),
  /** Mercado Livre: usuário que a conta vai usar (spec 012, seção 2.5). Obrigatório na tela; a API aceita ausente. */
  expectedUser: z.string().trim().min(1).max(100).optional(),
});
export type CreateMarketplaceAccountInput = z.infer<typeof CreateMarketplaceAccountSchema>;

/**
 * `credential`, quando enviada, **substitui** o valor anterior por inteiro — não existe edição
 * parcial de uma credencial já salva (spec 011, seção 2.2).
 */
export const UpdateMarketplaceAccountSchema = z
  .object({
    label: z.string().min(1).optional(),
    credential: z.string().min(1).optional(),
    expectedUser: z.string().trim().min(1).max(100).optional(),
  })
  .refine((data) => data.label !== undefined || data.credential !== undefined || data.expectedUser !== undefined, {
    message: "Informe ao menos um campo para atualizar.",
  });
export type UpdateMarketplaceAccountInput = z.infer<typeof UpdateMarketplaceAccountSchema>;

export const UpdateMarketplaceAccountStatusSchema = z.object({
  active: z.boolean(),
});
export type UpdateMarketplaceAccountStatusInput = z.infer<typeof UpdateMarketplaceAccountStatusSchema>;

export const ListMarketplaceAccountsQuerySchema = z.object({
  marketplace: MarketplaceEnum.optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});
export type ListMarketplaceAccountsQuery = z.infer<typeof ListMarketplaceAccountsQuerySchema>;
