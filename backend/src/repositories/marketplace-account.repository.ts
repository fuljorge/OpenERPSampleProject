import { ObjectId, type Collection, type Db, type Filter } from "mongodb";
import type { Marketplace, ConnectionStatus } from "../schemas/marketplace-account.schema.js";

export interface MarketplaceAccountDocument {
  _id: ObjectId;
  marketplace: Marketplace;
  label: string;
  /** Sempre criptografado (spec 011, seção 3) — nunca texto puro nesta collection. */
  credential: string;
  credentialPreview: string;
  connectionStatus: ConnectionStatus;
  active: boolean;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  /** Fluxo OAuth em andamento (spec 012, seção 2.2): `state` aleatório de uso único, com validade
   * curta. Presente só entre "Conectar" e a volta do Mercado Livre; nunca exposto pela API. */
  oauthState?: string;
  oauthStateExpiresAt?: Date;
  /** PKCE: `code_verifier` do fluxo em andamento — vive e morre junto com o `state`. */
  oauthCodeVerifier?: string;
  /** Usuário do Mercado Livre que a conta deve usar — apelido ou ID (spec 012, seção 2.5). Não é segredo. */
  expectedUser?: string;
  /** Identidade de quem autorizou o aplicativo: preenchida ao conectar, limpa ao desconectar. */
  connectedUserId?: string;
  connectedNickname?: string;
  /** Trava por conta (spec 012, seção 2.3; ADR-023): uma operação do conector por vez. Campos internos. */
  operationLeaseOwner?: string;
  operationLeaseExpiresAt?: Date;
}

export interface MarketplaceAccountRecord {
  id: string;
  marketplace: Marketplace;
  label: string;
  credential: string;
  credentialPreview: string;
  connectionStatus: ConnectionStatus;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  expectedUser: string | null;
  connectedUserId: string | null;
  connectedNickname: string | null;
}

export interface CreateMarketplaceAccountRecordInput {
  marketplace: Marketplace;
  label: string;
  credential: string;
  credentialPreview: string;
  createdBy: string;
  expectedUser?: string;
}

export interface UpdateMarketplaceAccountProfileInput {
  label?: string;
  credential?: string;
  credentialPreview?: string;
  expectedUser?: string;
}

export interface ListMarketplaceAccountsOptions {
  marketplace?: Marketplace;
  active?: boolean;
}

function collection(db: Db): Collection<MarketplaceAccountDocument> {
  return db.collection<MarketplaceAccountDocument>("marketplace_accounts");
}

function toRecord(doc: MarketplaceAccountDocument): MarketplaceAccountRecord {
  return {
    id: doc._id.toHexString(),
    marketplace: doc.marketplace,
    label: doc.label,
    credential: doc.credential,
    credentialPreview: doc.credentialPreview,
    connectionStatus: doc.connectionStatus,
    active: doc.active,
    createdBy: doc.createdBy.toHexString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    expectedUser: doc.expectedUser ?? null,
    connectedUserId: doc.connectedUserId ?? null,
    connectedNickname: doc.connectedNickname ?? null,
  };
}

export const marketplaceAccountRepository = {
  async findById(db: Db, id: string): Promise<MarketplaceAccountRecord | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await collection(db).findOne({ _id: new ObjectId(id) });
    return doc ? toRecord(doc) : null;
  },

  async list(db: Db, options: ListMarketplaceAccountsOptions = {}): Promise<MarketplaceAccountRecord[]> {
    const filter: Filter<MarketplaceAccountDocument> = {};
    if (options.marketplace !== undefined) filter.marketplace = options.marketplace;
    if (options.active !== undefined) filter.active = options.active;

    const docs = await collection(db).find(filter).sort({ createdAt: 1 }).toArray();
    return docs.map(toRecord);
  },

  async create(db: Db, input: CreateMarketplaceAccountRecordInput): Promise<MarketplaceAccountRecord> {
    const now = new Date();
    const doc: MarketplaceAccountDocument = {
      _id: new ObjectId(),
      marketplace: input.marketplace,
      label: input.label,
      credential: input.credential,
      credentialPreview: input.credentialPreview,
      connectionStatus: "disconnected",
      active: true,
      createdBy: new ObjectId(input.createdBy),
      ...(input.expectedUser !== undefined ? { expectedUser: input.expectedUser } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await collection(db).insertOne(doc);
    return toRecord(doc);
  },

  async updateProfile(db: Db, id: string, input: UpdateMarketplaceAccountProfileInput): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const patch: Partial<Pick<MarketplaceAccountDocument, "label" | "credential" | "credentialPreview" | "expectedUser">> = {};
    if (input.label !== undefined) patch.label = input.label;
    if (input.credential !== undefined) patch.credential = input.credential;
    if (input.credentialPreview !== undefined) patch.credentialPreview = input.credentialPreview;
    if (input.expectedUser !== undefined) patch.expectedUser = input.expectedUser;

    await collection(db).updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...patch, updatedAt: new Date() } },
    );
  },

  /**
   * Troca só o ciphertext (rotação de chave — spec 011, seção 3.1), condicionada ao valor que
   * foi lido: se a conta foi editada por um admin no meio da rotação, o filtro não casa e nada
   * é sobrescrito. Não mexe em `updatedAt` — rotação não é uma edição da conta.
   */
  async replaceCredentialCiphertext(db: Db, id: string, expected: string, next: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await collection(db).updateOne(
      { _id: new ObjectId(id), credential: expected },
      { $set: { credential: next } },
    );
    return result.modifiedCount === 1;
  },

  async setOAuthState(db: Db, id: string, state: string, expiresAt: Date, codeVerifier: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne(
      { _id: new ObjectId(id) },
      { $set: { oauthState: state, oauthStateExpiresAt: expiresAt, oauthCodeVerifier: codeVerifier } },
    );
  },

  /**
   * Consome o `state` de forma **atômica** (uso único): quem chega primeiro leva a conta e o
   * `state` some — replay e duas abas simultâneas não passam duas vezes. Devolve também a validade
   * (lida antes de apagar) para o chamador rejeitar um `state` expirado.
   */
  async consumeOAuthState(
    db: Db,
    state: string,
  ): Promise<{ account: MarketplaceAccountRecord; expiresAt: Date | undefined; codeVerifier: string | undefined } | null> {
    const doc = await collection(db).findOneAndUpdate(
      { oauthState: state },
      { $unset: { oauthState: "", oauthStateExpiresAt: "", oauthCodeVerifier: "" } },
      { returnDocument: "before" },
    );
    return doc
      ? { account: toRecord(doc), expiresAt: doc.oauthStateExpiresAt, codeVerifier: doc.oauthCodeVerifier }
      : null;
  },

  /**
   * Grava a credencial completa (com tokens), a identidade de quem autorizou (spec 012, seção 2.5) e marca
   * a conta como conectada.
   */
  async saveConnectedCredential(
    db: Db,
    id: string,
    credential: string,
    identity: { userId: string; nickname?: string | undefined },
  ): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          credential,
          connectionStatus: "connected",
          connectedUserId: identity.userId,
          updatedAt: new Date(),
          ...(identity.nickname !== undefined ? { connectedNickname: identity.nickname } : {}),
        },
        ...(identity.nickname === undefined ? { $unset: { connectedNickname: "" } } : {}),
      },
    );
  },

  async updateStatus(db: Db, id: string, active: boolean): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne(
      { _id: new ObjectId(id) },
      { $set: { active, updatedAt: new Date() } },
    );
  },

  /**
   * Desconecta a conta (spec 011, seção 2.2.2). Grava, se houver, a credencial já sem tokens e
   * remove um `state` de OAuth pendente — senão um retorno do Mercado Livre que ainda estivesse
   * a caminho reconectaria uma conta que o admin acabou de desconectar.
   */
  async markDisconnected(db: Db, id: string, credentialWithoutTokens?: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          connectionStatus: "disconnected",
          updatedAt: new Date(),
          ...(credentialWithoutTokens !== undefined ? { credential: credentialWithoutTokens } : {}),
        },
        $unset: {
          oauthState: "",
          oauthStateExpiresAt: "",
          oauthCodeVerifier: "",
          connectedUserId: "",
          connectedNickname: "",
        },
      },
    );
  },

  /**
   * Tenta obter a trava da conta (uma operação do conector por vez — ADR-023): só passa se não há
   * trava ou se a anterior venceu. Atômico (`findOneAndUpdate` com o filtro na própria condição).
   */
  async acquireOperationLease(db: Db, id: string, owner: string, ttlMs: number): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const now = new Date();
    const doc = await collection(db).findOneAndUpdate(
      {
        _id: new ObjectId(id),
        $or: [{ operationLeaseExpiresAt: { $exists: false } }, { operationLeaseExpiresAt: { $lte: now } }],
      },
      { $set: { operationLeaseOwner: owner, operationLeaseExpiresAt: new Date(now.getTime() + ttlMs) } },
      { returnDocument: "after" },
    );
    return doc?.operationLeaseOwner === owner;
  },

  /** Solta a trava só se ainda for do mesmo dono (uma trava vencida e retomada por outro não é tocada). */
  async releaseOperationLease(db: Db, id: string, owner: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne(
      { _id: new ObjectId(id), operationLeaseOwner: owner },
      { $unset: { operationLeaseOwner: "", operationLeaseExpiresAt: "" } },
    );
  },

  /**
   * Marca a conta como `expired` (refresh_token recusado — spec 012, seção 2.3), mas **só** se ela não
   * mudou desde a leitura (mesmo ciphertext) e não foi desconectada no meio da operação.
   */
  async markExpiredIfUnchanged(db: Db, id: string, expectedCiphertext: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await collection(db).updateOne(
      { _id: new ObjectId(id), credential: expectedCiphertext, connectionStatus: { $ne: "disconnected" } },
      { $set: { connectionStatus: "expired", updatedAt: new Date() } },
    );
    return result.modifiedCount === 1;
  },

  /** Remoção física (ADR-022) — só o serviço, depois de validar a ordem Desconectar → Desativar. */
  async delete(db: Db, id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await collection(db).deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount === 1;
  },

  async updateConnectionStatus(db: Db, id: string, connectionStatus: ConnectionStatus): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne(
      { _id: new ObjectId(id) },
      { $set: { connectionStatus, updatedAt: new Date() } },
    );
  },
};
