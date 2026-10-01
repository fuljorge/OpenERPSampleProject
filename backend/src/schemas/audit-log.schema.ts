import { z } from "zod";

/**
 * Ações auditáveis (mínimo obrigatório), ver specs/008-auditoria/spec.md, seção 3. Enum
 * fechado — nenhum serviço grava uma ação fora desta lista.
 */
export const AuditActionEnum = z.enum([
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "USER_CREATE",
  "USER_UPDATE",
  "USER_DISABLE",
  "PRODUCT_CREATE",
  "PRODUCT_UPDATE",
  "PRODUCT_DISABLE",
  "PRODUCT_PUBLISH",
  "PRODUCT_UNPUBLISH",
  "PRODUCT_SOLD",
  "PRICE_UPDATE",
  "CATEGORY_CREATE",
  "CATEGORY_UPDATE",
  "CATEGORY_DISABLE",
  "MARKETPLACE_ACCOUNT_CREATE",
  "MARKETPLACE_ACCOUNT_UPDATE",
  "MARKETPLACE_ACCOUNT_DISABLE",
  "MARKETPLACE_ACCOUNT_DISCONNECT",
  "MARKETPLACE_ACCOUNT_DELETE",
  "MARKETPLACE_ACCOUNT_VIEW",
  "MARKETPLACE_CREDENTIAL_KEY_ROTATE",
  "MERCADO_LIVRE_PACKAGE_SETTINGS_UPDATE",
  "AI_SETTINGS_UPDATE",
]);
export type AuditAction = z.infer<typeof AuditActionEnum>;

export const AuditLogSchema = z.object({
  // Ausente quando a ação não pôde ser atribuída a um usuário (ex.: LOGIN_FAILED para um
  // e-mail que não existe — spec 008, critério de aceite).
  userId: z.string().optional(),
  action: AuditActionEnum,
  entity: z.string(),
  entityId: z.string().optional(),
  timestamp: z.date(),
  metadata: z.record(z.unknown()).optional(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

/**
 * Contrato de saída pública — um registro com `id` (string), usado por GET /api/audit-logs.
 * `userId`/`entityId`/`metadata` aceitam `null` além de ausente: documentos gravados antes de
 * `mongo.client.ts` usar `ignoreUndefined: true` têm `null` explícito em vez da chave
 * simplesmente ausente — a leitura precisa tolerar dados históricos, não só os novos.
 */
export const AuditLogOutputSchema = z.object({
  id: z.string(),
  userId: z.string().nullable().optional(),
  action: AuditActionEnum,
  entity: z.string(),
  entityId: z.string().nullable().optional(),
  timestamp: z.date(),
  metadata: z.record(z.unknown()).nullable().optional(),
});
export type AuditLogOutput = z.infer<typeof AuditLogOutputSchema>;

export const AuditLogQuerySchema = z.object({
  entity: z.string().optional(),
  action: AuditActionEnum.optional(),
  userId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export const AuditLogListResultSchema = z.object({
  items: z.array(AuditLogOutputSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type AuditLogListResult = z.infer<typeof AuditLogListResultSchema>;
