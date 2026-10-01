import type { Collection, Db } from "mongodb";

/**
 * Chaves de dados (DEK) que cifram as credenciais de marketplace — spec 011, seção 3.1; ADR-021.
 * `wrappedKey` é a chave já cifrada pela chave-mestra (variável de ambiente): o banco nunca
 * guarda uma chave utilizável sozinha. A chave **ativa** é sempre a de maior `version`; as demais
 * ficam retidas só para decifrar valores antigos. `_id` = `k{version}`, então duas rotações
 * concorrentes não criam a mesma versão (chave duplicada) — sem precisar de transação.
 */
export interface CredentialKeyDocument {
  _id: string;
  version: number;
  wrappedKey: string;
  createdAt: Date;
  createdBy: string | null;
}

export interface CredentialKeyRecord {
  id: string;
  version: number;
  wrappedKey: string;
  createdAt: Date;
  createdBy: string | null;
}

function collection(db: Db): Collection<CredentialKeyDocument> {
  return db.collection<CredentialKeyDocument>("credential_keys");
}

function toRecord(doc: CredentialKeyDocument): CredentialKeyRecord {
  return {
    id: doc._id,
    version: doc.version,
    wrappedKey: doc.wrappedKey,
    createdAt: doc.createdAt,
    createdBy: doc.createdBy,
  };
}

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 11000;
}

export const credentialKeyRepository = {
  /** A chave ativa: a de maior versão. */
  async findLatest(db: Db): Promise<CredentialKeyRecord | null> {
    const doc = await collection(db).find().sort({ version: -1 }).limit(1).next();
    return doc ? toRecord(doc) : null;
  },

  async findById(db: Db, id: string): Promise<CredentialKeyRecord | null> {
    const doc = await collection(db).findOne({ _id: id });
    return doc ? toRecord(doc) : null;
  },

  /** Lança erro de chave duplicada (código 11000) se a versão já existir. */
  async insert(db: Db, record: CredentialKeyRecord): Promise<void> {
    await collection(db).insertOne({
      _id: record.id,
      version: record.version,
      wrappedKey: record.wrappedKey,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
    });
  },
};
