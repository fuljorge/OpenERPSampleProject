/**
 * Porta de abstração do provedor de IA (constituição, princípio VI). Nenhuma camada de
 * domínio ou serviço deve conhecer o SDK/API de um provedor concreto — apenas este contrato.
 * A validação estrutural do retorno (Zod) acontece em `services/ai-intake.service.ts` (006),
 * nunca aqui: este adapter só fala com o provedor e devolve o JSON bruto.
 */

export interface AiProviderImageInput {
  buffer: Buffer;
  mimeType: string;
}

export interface AiProviderPort {
  /**
   * Envia um prompt textual + imagens ao modelo multimodal e retorna a saída estruturada
   * bruta (ainda não validada). Implementações nunca devem inventar valores para campos que
   * o modelo não conseguiu determinar — devem instruir o provedor a retornar `null` nesses
   * casos (constituição, princípio I).
   */
  analyze(prompt: string, images: AiProviderImageInput[]): Promise<unknown>;
}
