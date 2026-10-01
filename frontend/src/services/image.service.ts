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

export interface UploadedImage {
  id: string;
  url: string;
}

export const imageService = {
  async upload(file: File): Promise<UploadedImage> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/images", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    return parseEnvelope<UploadedImage>(response);
  },

  async remove(id: string): Promise<void> {
    const response = await fetch(`/api/images/${id}`, { method: "DELETE", credentials: "include" });
    await parseEnvelope<null>(response);
  },
};
