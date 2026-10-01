import { useEffect } from "react";

interface ImageLightboxProps {
  url: string;
  onClose: () => void;
}

/**
 * Visualização ampliada de uma foto (spec 007, seção 6) — overlay em tela cheia sobre a tela
 * atual, sem trocar de rota. Fecha ao clicar fora da imagem, pressionar Esc, ou clicar no `×`;
 * clicar na própria imagem não fecha (evita fechar por acidente ao tentar dar zoom em touch).
 */
export function ImageLightbox({ url, onClose }: ImageLightboxProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-lg font-bold text-wine-900 shadow"
        onClick={onClose}
        aria-label="Fechar"
      >
        ×
      </button>
      <img
        src={url}
        alt=""
        className="max-h-[90vh] max-w-[90vw] object-contain"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
