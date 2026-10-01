import { z } from "zod";

/** Espelha `DashboardSummary` do backend (spec 009, seção 2) — os 6 indicadores do MVP. */
export const DashboardSummarySchema = z.object({
  disponiveis: z.number(),
  cadastradosHoje: z.number(),
  vendidos: z.number(),
  emRevisao: z.number(),
  semPreco: z.number(),
  semImagens: z.number(),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
