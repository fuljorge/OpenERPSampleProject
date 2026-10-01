import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getActiveCredentialKey, getCredentialKeyById } from "./credential-key.service.js";

/**
 * Criptografia reversível de credenciais de conector de marketplace (spec 011, seção 3) —
 * diferente de senha (Argon2id, hash, `password.service.ts`), o sistema precisa recuperar o
 * valor original para autenticar com a API do marketplace. AES-256-GCM via `node:crypto`
 * nativo, sem dependência nova (constituição, princípio V; plan 011, seção 1).
 *
 * A chave de dados vem de `credential-key.service.ts` (envelope encryption, ADR-021) e é lida do
 * banco a cada operação — sem cache, então uma rotação feita em outra instância vale na hora.
 * Formato: `{keyId}:{iv}:{authTag}:{dados}` — o id diz qual chave de dados decifra o valor.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // recomendado para GCM

/** Id da chave que cifrou `ciphertext`, ou `null` se o formato não for reconhecido. */
export function getCredentialKeyId(ciphertext: string): string | null {
  const parts = ciphertext.split(":");
  const keyId = parts[0];
  return parts.length === 4 && keyId ? keyId : null;
}

/** IV aleatório por chamada — nunca reaproveitado entre credenciais nem entre trocas da mesma conta. */
export async function encryptCredential(plain: string): Promise<string> {
  const { id, key } = await getActiveCredentialKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [id, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

/**
 * Lança se `ciphertext` estiver malformado, tiver sido adulterado (a tag de autenticação do GCM
 * detecta qualquer alteração) ou se a chave que o cifrou não existir. Nunca loga `ciphertext` nem
 * o valor decriptado (spec 011, seção 3).
 */
export async function decryptCredential(ciphertext: string): Promise<string> {
  const parts = ciphertext.split(":");
  const [keyId, ivB64, authTagB64, dataB64] = parts;
  if (parts.length !== 4 || !keyId || !ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Formato de credencial criptografada inválido.");
  }

  const key = await getCredentialKeyById(keyId);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));

  const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plain.toString("utf8");
}

/**
 * Valor mascarado para exibição (spec 011, seção 2.2) — calculado a partir do texto puro no
 * momento em que a credencial é salva, nunca derivado de uma decriptação posterior sob
 * demanda.
 */
export function maskCredential(plain: string): string {
  const last4 = plain.slice(-4);
  return `****${last4}`;
}
