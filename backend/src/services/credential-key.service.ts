import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getDb } from "../database/mongo.client.js";
import {
  credentialKeyRepository,
  isDuplicateKeyError,
  type CredentialKeyRecord,
} from "../repositories/credential-key.repository.js";

/**
 * Envelope encryption das credenciais de marketplace (spec 011, seção 3.1; ADR-021):
 *
 *   chave-mestra (env, fora do banco) → cifra → chaves de dados (banco, versionadas) → cifram → credenciais
 *
 * A chave-mestra (`MARKETPLACE_CREDENTIAL_MASTER_KEY`, 32 bytes em base64) nunca é gravada no
 * banco; as chaves de dados só existem no banco *cifradas por ela*. Um vazamento do banco isolado
 * não expõe nada. Trocar a chave de dados (botão "Rotacionar chave de criptografia") não exige
 * mexer na infraestrutura.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;
const MASTER_KEY_ENV = "MARKETPLACE_CREDENTIAL_MASTER_KEY";

export class CredentialKeyRotationConflictError extends Error {
  constructor() {
    super("Outra rotação de chave está em andamento. Aguarde e tente de novo.");
    this.name = "CredentialKeyRotationConflictError";
  }
}

function requireMasterKey(): Buffer {
  const value = process.env[MASTER_KEY_ENV];
  if (!value) throw new Error(`${MASTER_KEY_ENV} não configurada.`);

  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`${MASTER_KEY_ENV} deve decodificar (base64) para exatamente 32 bytes (AES-256).`);
  }
  return key;
}

/** O id da chave vai como dado autenticado (AAD): uma chave embrulhada não pode ser copiada para
 * outro registro sem que a autenticação do GCM falhe. */
function wrapKey(keyId: string, dataKey: Buffer): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, requireMasterKey(), iv);
  cipher.setAAD(Buffer.from(keyId, "utf8"));
  const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), wrapped.toString("base64")].join(":");
}

function unwrapKey(record: CredentialKeyRecord): Buffer {
  const [ivB64, tagB64, dataB64] = record.wrappedKey.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error(`Chave de criptografia "${record.id}" corrompida.`);

  try {
    const decipher = createDecipheriv(ALGORITHM, requireMasterKey(), Buffer.from(ivB64, "base64"));
    decipher.setAAD(Buffer.from(record.id, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  } catch {
    // Mensagem única e sem detalhe: causa típica é a chave-mestra ter sido trocada.
    throw new Error(`Não foi possível abrir a chave de criptografia "${record.id}" com a chave-mestra atual.`);
  }
}

async function insertVersion(version: number, createdBy: string | null): Promise<CredentialKeyRecord> {
  const id = `k${version}`;
  const record: CredentialKeyRecord = {
    id,
    version,
    wrappedKey: wrapKey(id, randomBytes(KEY_LENGTH_BYTES)),
    createdAt: new Date(),
    createdBy,
  };
  await credentialKeyRepository.insert(getDb(), record);
  return record;
}

/** Chave ativa (maior versão). Se ainda não existe nenhuma, cria a primeira — ninguém precisa
 * gerar chave manualmente. Duas requisições simultâneas criando a v1: uma perde a corrida
 * (`_id` duplicado) e lê a que ganhou. */
async function getActiveRecord(): Promise<CredentialKeyRecord> {
  const db = getDb();
  const latest = await credentialKeyRepository.findLatest(db);
  if (latest) return latest;

  try {
    return await insertVersion(1, null);
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const created = await credentialKeyRepository.findLatest(db);
    if (!created) throw err;
    return created;
  }
}

export async function getActiveCredentialKey(): Promise<{ id: string; key: Buffer }> {
  const record = await getActiveRecord();
  return { id: record.id, key: unwrapKey(record) };
}

export async function getCredentialKeyById(id: string): Promise<Buffer> {
  const record = await credentialKeyRepository.findById(getDb(), id);
  if (!record) throw new Error(`Chave de criptografia "${id}" não existe.`);
  return unwrapKey(record);
}

export interface ActiveKeyInfo {
  id: string;
  version: number;
  createdAt: Date;
}

export async function getActiveKeyInfo(): Promise<ActiveKeyInfo> {
  const { id, version, createdAt } = await getActiveRecord();
  return { id, version, createdAt };
}

/** Cria a próxima versão e a torna ativa (a de maior versão é, por definição, a ativa — a
 * ativação é atômica). Não re-cifra nada: isso é `credential-key-rotation.service.ts`. */
export async function createNextCredentialKey(actingUserId: string): Promise<{ previous: ActiveKeyInfo; next: ActiveKeyInfo }> {
  const previous = await getActiveRecord();
  try {
    const next = await insertVersion(previous.version + 1, actingUserId);
    return {
      previous: { id: previous.id, version: previous.version, createdAt: previous.createdAt },
      next: { id: next.id, version: next.version, createdAt: next.createdAt },
    };
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new CredentialKeyRotationConflictError();
    throw err;
  }
}
