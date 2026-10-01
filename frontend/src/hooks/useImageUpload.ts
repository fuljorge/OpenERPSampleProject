import { useMutation } from "@tanstack/react-query";
import { imageService } from "../services/image.service";

/**
 * Upload/remoção de fotos (spec 007). Sem barra de progresso — `fetch` não expõe progresso de
 * upload nativamente (exigiria trocar para `XMLHttpRequest`); simplificação de escopo aceita
 * para o MVP do cadastro manual, documentada em tasks.md de 005.
 */
export function useImageUpload() {
  const upload = useMutation({ mutationFn: (file: File) => imageService.upload(file) });
  const remove = useMutation({ mutationFn: (id: string) => imageService.remove(id) });
  return { upload, remove };
}
