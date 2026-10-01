import { useRef, useState } from "react";
import { useImageUpload } from "../hooks/useImageUpload";
import { MAX_PRODUCT_IMAGES, type Imagem } from "../schemas/product.schema";
import { ImageLightbox } from "./ImageLightbox";

interface ImageUploaderProps {
  images: Imagem[];
  onChange: (images: Imagem[]) => void;
  disabled?: boolean;
}

/**
 * Upload/remoção de fotos de um produto (spec 007, integrado a 005) — N fotos por peça, a
 * primeira da lista é a capa/principal (sem seletor dedicado, decisão de escopo do MVP). Cada
 * seleção de arquivo já envia para o Azure Blob Storage imediatamente (via `/api/images`); o
 * formulário só guarda os metadados (`id`, `url`) retornados, nunca o binário.
 */
export function ImageUploader({ images, onChange, disabled = false }: ImageUploaderProps) {
  const { upload, remove } = useImageUpload();
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const atLimit = images.length >= MAX_PRODUCT_IMAGES;

  async function handleFiles(files: FileList | null, source: "camera" | "gallery") {
    if (!files || files.length === 0 || disabled) return;
    setError(null);

    const remainingSlots = MAX_PRODUCT_IMAGES - images.length;
    const toUpload = Array.from(files).slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      setError(`Só é possível adicionar mais ${remainingSlots} foto(s) (limite de ${MAX_PRODUCT_IMAGES} por peça).`);
    }

    let current = images;
    for (const file of toUpload) {
      try {
        const uploaded = await upload.mutateAsync(file);
        current = [...current, { ...uploaded, ordem: current.length, tipo: null }];
        onChange(current);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível enviar a foto.");
      }
    }

    const ref = source === "camera" ? cameraInputRef : galleryInputRef;
    if (ref.current) ref.current.value = "";
  }

  async function handleRemove(image: Imagem) {
    setError(null);
    setRemovingId(image.id);
    try {
      await remove.mutateAsync(image.id);
      onChange(images.filter((img) => img.id !== image.id).map((img, i) => ({ ...img, ordem: i })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover a foto.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {images.map((image) => (
          <div key={image.id} className="relative h-24 w-24 overflow-hidden rounded-md border border-gray-200">
            <img
              src={image.url}
              alt=""
              className="h-full w-full cursor-pointer object-cover"
              onClick={() => setPreviewUrl(image.url)}
            />
            <button
              type="button"
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-red-600 shadow disabled:opacity-50"
              disabled={disabled || removingId === image.id}
              onClick={() => void handleRemove(image)}
              aria-label="Remover foto"
            >
              ×
            </button>
          </div>
        ))}
        {!atLimit && !upload.isPending && (
          <>
            <label
              className={`flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-gray-300 text-center text-xs text-gray-500 hover:border-wine-400 ${
                disabled ? "pointer-events-none opacity-50" : ""
              }`}
            >
              📷
              <span>Tirar foto</span>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={disabled}
                onChange={(e) => void handleFiles(e.target.files, "camera")}
              />
            </label>
            <label
              className={`flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-gray-300 text-center text-xs text-gray-500 hover:border-wine-400 ${
                disabled ? "pointer-events-none opacity-50" : ""
              }`}
            >
              🖼️
              <span>Galeria</span>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={disabled}
                onChange={(e) => void handleFiles(e.target.files, "gallery")}
              />
            </label>
          </>
        )}
        {upload.isPending && (
          <div className="flex h-24 w-24 flex-col items-center justify-center rounded-md border border-dashed border-gray-300 text-center text-xs text-gray-500 opacity-50">
            Enviando...
          </div>
        )}
      </div>
      <p className="text-xs text-gray-500">
        {images.length} de {MAX_PRODUCT_IMAGES} fotos. A primeira é usada como capa.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {previewUrl && <ImageLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}
