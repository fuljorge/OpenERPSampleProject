import { ProductForm } from "../products/ProductForm";
import { AiConfidenceBadges } from "./AiConfidenceBadges";
import { aiSuggestionToFormValues, type AiSuggestedProduct } from "../../schemas/ai-intake.schema";
import { toProductPayload, type Imagem, type ProductFormValues } from "../../schemas/product.schema";

interface AiReviewFormProps {
  suggestion: AiSuggestedProduct;
  defaultImages: Imagem[];
  onConfirm: (payload: unknown) => Promise<void>;
  isSubmitting: boolean;
}

/**
 * Reaproveita o `ProductForm` de 005 (spec 006, seção "Fora de escopo": nenhum formulário
 * paralelo) pré-preenchido com a sugestão da IA — o operador revisa/corrige qualquer campo
 * antes de "Salvar produto"; nada é persistido antes disso (Human in the Loop).
 */
export function AiReviewForm({ suggestion, defaultImages, onConfirm, isSubmitting }: AiReviewFormProps) {
  async function handleSubmit(values: ProductFormValues, imagens: Imagem[]) {
    const payload = {
      ...toProductPayload(values, imagens),
      // `model: null` — o frontend genuinemente não sabe qual modelo respondeu (a resposta de
      // /analyze não inclui essa informação); nunca inventar um valor (constituição, princípio I).
      ai_metadata: { generated: true, model: null, fields: suggestion.ai_metadata.fields },
    };
    await onConfirm(payload);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gold-300 bg-gold-50 p-4">
        <p className="mb-2 text-sm font-medium text-wine-900">O que a IA identificou:</p>
        <AiConfidenceBadges suggestion={suggestion} />
        <p className="mt-2 text-xs text-gray-600">
          Revise e corrija qualquer campo abaixo antes de salvar — nada foi salvo ainda.
        </p>
      </div>
      <ProductForm
        mode="create"
        defaultValues={aiSuggestionToFormValues(suggestion)}
        defaultImages={defaultImages}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
