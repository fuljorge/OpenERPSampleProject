import { z } from "zod";
import { AiSuggestedProductSchema } from "../../../shared/dist/schemas/ai-intake.schema.js";

export { AiSuggestedProductSchema };
export type { AiSuggestedProduct } from "../../../shared/dist/schemas/ai-intake.schema.js";

export const AiAnalysisInputSchema = z.object({
  prompt: z.string().min(1, "Descreva a peça antes de analisar."),
});
export type AiAnalysisInput = z.infer<typeof AiAnalysisInputSchema>;
