import { AuditLogListResultSchema, type AuditAction, type AuditLogListResult } from "../schemas/audit-log.schema";

export class ApiError extends Error {}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success) {
    throw new ApiError(body.error ?? "Erro inesperado. Tente novamente.");
  }
  return body.data as T;
}

export interface AuditLogFilters {
  entity?: string;
  action?: AuditAction;
  userId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export const auditLogService = {
  async list(filters: AuditLogFilters = {}): Promise<AuditLogListResult> {
    const params = new URLSearchParams();
    if (filters.entity) params.set("entity", filters.entity);
    if (filters.action) params.set("action", filters.action);
    if (filters.userId) params.set("userId", filters.userId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));

    const query = params.toString();
    const response = await fetch(`/api/audit-logs${query ? `?${query}` : ""}`, {
      credentials: "include",
    });
    return AuditLogListResultSchema.parse(await parseEnvelope<unknown>(response));
  },
};
