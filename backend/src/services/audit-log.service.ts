import { getDb } from "../database/mongo.client.js";
import { auditLogRepository } from "../repositories/audit-log.repository.js";
import type { AuditAction, AuditLogListResult } from "../schemas/audit-log.schema.js";

/**
 * Registra um evento auditável. Consumido diretamente pelos serviços de outros domínios
 * (auth, users, products, categories), na mesma operação lógica que originou o evento — ver
 * specs/008-auditoria/plan.md, seção 4.
 *
 * Falha ao gravar o log NUNCA interrompe a operação de negócio principal (ex.: não impede um
 * login bem-sucedido só porque a auditoria falhou) — decisão registrada em
 * specs/008-auditoria/plan.md, seção 7.
 */
export async function record(
  action: AuditAction,
  entity: string,
  entityId: string | undefined,
  userId: string | undefined,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = getDb();
    await auditLogRepository.insert(db, {
      action,
      entity,
      entityId,
      userId,
      metadata,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("Falha ao gravar audit log:", err);
  }
}

export interface ListAuditLogsInput {
  entity?: string;
  action?: AuditAction;
  userId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

/** Leitura paginada — restrita a admin na camada de rota (authorize(["admin"])). */
export async function list(input: ListAuditLogsInput = {}): Promise<AuditLogListResult> {
  const db = getDb();
  const page = input.page ?? 1;
  const limit = input.limit ?? 50;
  const filter = {
    entity: input.entity,
    userId: input.userId,
    action: input.action,
    from: input.from,
    to: input.to,
  };

  const [items, total] = await Promise.all([
    auditLogRepository.find(db, filter, { skip: (page - 1) * limit, limit }),
    auditLogRepository.count(db, filter),
  ]);

  return { items, total, page, limit };
}
