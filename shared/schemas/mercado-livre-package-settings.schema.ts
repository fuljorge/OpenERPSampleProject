import { z } from "zod";

/**
 * Pacote padrão do Mercado Livre (spec 012, seção 3.4; ADR-027) — o Mercado Envios 2 exige
 * dimensões de pacote em toda publicação, e o ERP não captura essas dimensões por produto nesta
 * versão. Um único conjunto de medidas para toda publicação (sem exceção por categoria/departamento
 * — ADR-027), editado pela dona do brechó numa tela de admin, guardado no banco (não mais uma
 * variável de ambiente). `peso_g` é sempre obrigatório aqui — reserva para quando a peça não tiver
 * `peso` preenchido no cadastro; o peso do produto, quando existir, tem prioridade.
 */
export const MercadoLivrePackageSettingsSchema = z.object({
  altura_cm: z.number().int().positive(),
  largura_cm: z.number().int().positive(),
  comprimento_cm: z.number().int().positive(),
  peso_g: z.number().int().positive(),
});
export type MercadoLivrePackageSettings = z.infer<typeof MercadoLivrePackageSettingsSchema>;

/** Registro completo devolvido pela API — inclui quem editou e quando (spec 008, auditoria). */
export const MercadoLivrePackageSettingsRecordSchema = MercadoLivrePackageSettingsSchema.extend({
  updatedAt: z.coerce.date(),
  updatedBy: z.string(),
});
export type MercadoLivrePackageSettingsRecord = z.infer<typeof MercadoLivrePackageSettingsRecordSchema>;
