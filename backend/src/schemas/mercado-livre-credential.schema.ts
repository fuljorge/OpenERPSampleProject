import { z } from "zod";

/**
 * Conteúdo de `marketplace_accounts.credential` para o Mercado Livre (spec 012, seção 2.1) — um
 * JSON serializado e cifrado como um único valor (spec 011, seção 3).
 *
 * `client_id`/`client_secret` são digitados pelo admin no cadastro; os campos de token só
 * existem depois que o fluxo OAuth 2.0 é concluído (spec 012, seção 2.2) — nunca são digitados.
 */
export const MercadoLivreCredentialSchema = z
  .object({
    client_id: z.string().trim().min(1),
    client_secret: z.string().trim().min(1),
    access_token: z.string().min(1).optional(),
    refresh_token: z.string().min(1).optional(),
    /** ISO 8601 — momento em que o `access_token` expira (6h após a emissão). */
    expires_at: z.string().optional(),
    user_id: z.union([z.number(), z.string()]).optional(),
  })
  .strict();
export type MercadoLivreCredential = z.infer<typeof MercadoLivreCredentialSchema>;

/** `null` se `raw` não for um JSON válido no formato acima. */
export function parseMercadoLivreCredential(raw: string): MercadoLivreCredential | null {
  try {
    const result = MercadoLivreCredentialSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
