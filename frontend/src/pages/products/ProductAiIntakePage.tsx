import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AiIntakeForm } from "../../features/products-ai/AiIntakeForm";
import { AiReviewForm } from "../../features/products-ai/AiReviewForm";
import { useAiAnalysis } from "../../hooks/useAiAnalysis";
import { useImageUpload } from "../../hooks/useImageUpload";
import type { AiSuggestedProduct } from "../../schemas/ai-intake.schema";
import type { Imagem } from "../../schemas/product.schema";
import { aiIntakeService } from "../../services/ai-intake.service";

/**
 * Orquestra o fluxo de 006: fotos + descrição → `/analyze` (nunca persiste, nunca gera SKU —
 * constituição princípio I) → revisão pré-preenchida → "Salvar produto" explícito → `/confirm`
 * (gera SKU via 004, persiste via 005). Nenhuma chamada a `/confirm` acontece automaticamente.
 */
export function ProductAiIntakePage() {
  const navigate = useNavigate();
  const analysis = useAiAnalysis();
  const { upload } = useImageUpload();

  const [suggestion, setSuggestion] = useState<AiSuggestedProduct | null>(null);
  const [reviewImages, setReviewImages] = useState<Imagem[]>([]);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  async function handleAnalyze(prompt: string, images: File[]) {
    setIntakeError(null);

    let result: AiSuggestedProduct;
    try {
      result = await analysis.mutateAsync({ prompt, images });
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : "Não foi possível analisar a peça.");
      return;
    }

    // Só agora as fotos viram upload real (Azure Blob, via 007) — a análise em si foi
    // transiente. Mesmos arquivos já usados em /analyze, sem pedir de novo ao operador.
    setIsUploadingPhotos(true);
    try {
      const uploaded: Imagem[] = [];
      for (const [index, file] of images.entries()) {
        const meta = await upload.mutateAsync(file);
        uploaded.push({ ...meta, ordem: index, tipo: null });
      }
      setReviewImages(uploaded);
      setSuggestion(result);
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : "Não foi possível enviar as fotos.");
    } finally {
      setIsUploadingPhotos(false);
    }
  }

  async function handleConfirm(payload: unknown) {
    setConfirmError(null);
    setIsConfirming(true);
    try {
      await aiIntakeService.confirm(payload);
      navigate("/products");
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Não foi possível salvar o produto.");
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-bold text-wine-900">Cadastrar peça com IA</h1>

      {!suggestion && (
        <>
          <p className="text-sm text-gray-600">
            Envie fotos da peça e descreva brevemente — a IA preenche uma sugestão de ficha para você revisar antes
            de salvar.
          </p>
          <AiIntakeForm
            onSubmit={(prompt, images) => void handleAnalyze(prompt, images)}
            isSubmitting={analysis.isPending || isUploadingPhotos}
            error={intakeError}
          />
        </>
      )}

      {suggestion && (
        <>
          {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
          <AiReviewForm
            suggestion={suggestion}
            defaultImages={reviewImages}
            onConfirm={handleConfirm}
            isSubmitting={isConfirming}
          />
        </>
      )}
    </div>
  );
}
