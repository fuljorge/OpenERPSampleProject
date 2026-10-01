import { useEffect, useState } from "react";
import { MAX_PRODUCT_IMAGES } from "../../schemas/product.schema";

interface PickedImage {
  file: File;
  previewUrl: string;
}

interface AiIntakeFormProps {
  onSubmit: (prompt: string, images: File[]) => void;
  isSubmitting: boolean;
  error: string | null;
}

/**
 * Upload de fotos + descrição para análise por IA (spec 006, seção 3). Diferente do
 * `ImageUploader` (007/005): as fotos aqui **não** são enviadas para o Azure Blob Storage na
 * hora — a análise usa os bytes diretamente (`POST /products/analyze`, transiente, nada
 * persiste). Só depois que o operador revisar e confirmar é que essas mesmas fotos viram
 * upload real (`ProductAiIntakePage`).
 */
export function AiIntakeForm({ onSubmit, isSubmitting, error }: AiIntakeFormProps) {
  const [images, setImages] = useState<PickedImage[]>([]);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    return () => {
      for (const image of images) URL.revokeObjectURL(image.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só revoga no unmount, não a cada mudança de `images`
  }, []);

  const atLimit = images.length >= MAX_PRODUCT_IMAGES;
  const canSubmit = images.length > 0 && prompt.trim().length > 0 && !isSubmitting;

  function handleFiles(files: FileList | null) {
    if (!files || isSubmitting) return;
    const remaining = MAX_PRODUCT_IMAGES - images.length;
    const next = Array.from(files)
      .slice(0, remaining)
      .map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setImages((prev) => [...prev, ...next]);
  }

  function removeImage(index: number) {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit(
      prompt,
      images.map((image) => image.file),
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">Fotos</p>
        <div className="flex flex-wrap gap-3">
          {images.map((image, index) => (
            <div key={image.previewUrl} className="relative h-24 w-24 overflow-hidden rounded-md border border-gray-200">
              <img src={image.previewUrl} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-red-600 shadow disabled:opacity-50"
                disabled={isSubmitting}
                onClick={() => removeImage(index)}
                aria-label="Remover foto"
              >
                ×
              </button>
            </div>
          ))}
          {!atLimit && (
            <>
              <label
                className={`flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-gray-300 text-center text-xs text-gray-500 hover:border-wine-400 ${
                  isSubmitting ? "pointer-events-none opacity-50" : ""
                }`}
              >
                📷
                <span>Tirar foto</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  disabled={isSubmitting}
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <label
                className={`flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-gray-300 text-center text-xs text-gray-500 hover:border-wine-400 ${
                  isSubmitting ? "pointer-events-none opacity-50" : ""
                }`}
              >
                🖼️
                <span>Galeria</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={isSubmitting}
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {images.length} de {MAX_PRODUCT_IMAGES} fotos. Recomendado: frente, costas, etiqueta, detalhes e defeitos
          (se houver).
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="ai-prompt">
          Descreva a peça
        </label>
        <textarea
          id="ai-prompt"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600"
          rows={3}
          placeholder="Ex.: Bermuda jeans stretch masculina nova, tamanho 32"
          value={prompt}
          disabled={isSubmitting}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        className="rounded-md bg-wine-800 px-4 py-2 text-sm font-medium text-gold-100 hover:bg-wine-900 disabled:opacity-50"
        disabled={!canSubmit}
      >
        {isSubmitting ? "Analisando peça..." : "Analisar com IA"}
      </button>
    </form>
  );
}
