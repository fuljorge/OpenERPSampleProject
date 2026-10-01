import { z } from "zod";

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

export const AuditLogEntrySchema = z.object({
  id: z.string(),
  // .nullable(): registros antigos (gravados antes do backend usar ignoreUndefined no driver
  // Mongo) têm null explícito em vez de ausente.
  userId: z.string().nullable().optional(),
  action: AuditActionEnum,
  entity: z.string(),
  entityId: z.string().nullable().optional(),
  timestamp: z.coerce.date(),
  metadata: z.record(z.unknown()).nullable().optional(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const AuditLogListResultSchema = z.object({
  items: z.array(AuditLogEntrySchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type AuditLogListResult = z.infer<typeof AuditLogListResultSchema>;
