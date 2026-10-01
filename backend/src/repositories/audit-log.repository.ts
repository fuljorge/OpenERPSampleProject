import type { Collection, Db, Filter, ObjectId } from "mongodb";
import type { AuditLog } from "../schemas/audit-log.schema.js";

export interface AuditLogDocument extends AuditLog {
  _id?: ObjectId;
}

export interface AuditLogRecord extends AuditLog {
  id: string;
}

export interface AuditLogFilter {
  entity?: string;
  entityId?: string;
  action?: AuditLog["action"];
  userId?: string;
  from?: Date;
  to?: Date;
}

export interface AuditLogListOptions {
  limit?: number;
  skip?: number;
}

function collection(db: Db): Collection<AuditLogDocument> {
  return db.collection<AuditLogDocument>("audit_logs");
}

function toRecord(doc: AuditLogDocument): AuditLogRecord {
  return {
    id: doc._id!.toHexString(),
    userId: doc.userId,
    action: doc.action,
    entity: doc.entity,
    entityId: doc.entityId,
    timestamp: doc.timestamp,
    metadata: doc.metadata,
  };
}

function toMongoFilter(filter: AuditLogFilter): Filter<AuditLogDocument> {
  const mongoFilter: Filter<AuditLogDocument> = {};
  if (filter.entity !== undefined) mongoFilter.entity = filter.entity;
  if (filter.entityId !== undefined) mongoFilter.entityId = filter.entityId;
  if (filter.action !== undefined) mongoFilter.action = filter.action;
  if (filter.userId !== undefined) mongoFilter.userId = filter.userId;
  if (filter.from !== undefined || filter.to !== undefined) {
    mongoFilter.timestamp = {
      ...(filter.from !== undefined ? { $gte: filter.from } : {}),
      ...(filter.to !== undefined ? { $lte: filter.to } : {}),
    };
  }
  return mongoFilter;
}

/**
 * Só expõe inserção e leitura — nenhum `updateOne`/`deleteOne`, reforçando a imutabilidade de
 * `audit_logs` (constituição, princípio IX) também na camada de dados, não só por convenção.
 */
export const auditLogRepository = {
  async insert(db: Db, log: AuditLog): Promise<void> {
    await collection(db).insertOne(log);
  },

  async find(db: Db, filter: AuditLogFilter, options: AuditLogListOptions = {}): Promise<AuditLogRecord[]> {
    const docs = await collection(db)
      .find(toMongoFilter(filter))
      .sort({ timestamp: -1 })
      .skip(options.skip ?? 0)
      .limit(options.limit ?? 50)
      .toArray();
    return docs.map(toRecord);
  },

  async count(db: Db, filter: AuditLogFilter): Promise<number> {
    return collection(db).countDocuments(toMongoFilter(filter));
  },
};
