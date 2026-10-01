import { useMutation } from "@tanstack/react-query";
import { aiIntakeService } from "../services/ai-intake.service";

/** Estados `loading/success/error` nativos do TanStack Query (`isPending`/`isSuccess`/
 * `isError`); `empty` é o estado inicial antes de qualquer análise (`isIdle`) — spec 006,
 * seção 7. */
export function useAiAnalysis() {
  return useMutation({
    mutationFn: ({ prompt, images }: { prompt: string; images: File[] }) => aiIntakeService.analyze(prompt, images),
  });
}

/** Reavaliação de produto já cadastrado (spec 006, seção 9) — tela de edição (005, seção 4.3). */
export function useReanalyzeProduct() {
  return useMutation({
    mutationFn: (productId: string) => aiIntakeService.reanalyze(productId),
  });
}
