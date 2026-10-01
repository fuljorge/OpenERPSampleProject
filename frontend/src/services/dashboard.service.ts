import { DashboardSummarySchema, type DashboardSummary } from "../schemas/dashboard.schema";

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

export const dashboardService = {
  async getSummary(): Promise<DashboardSummary> {
    const response = await fetch("/api/dashboard/summary", { credentials: "include" });
    return DashboardSummarySchema.parse(await parseEnvelope<unknown>(response));
  },
};
