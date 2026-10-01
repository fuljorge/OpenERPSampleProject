import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();

vi.mock("../repositories/audit-log.repository.js", () => ({
  auditLogRepository: {
    insert: (...args: unknown[]) => insertMock(...args),
  },
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

const { record } = await import("./audit-log.service.js");

describe("audit-log.service.record", () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue(undefined);
  });

  it("monta o documento correto para LOGIN_SUCCESS", async () => {
    await record("LOGIN_SUCCESS", "user", "user-id-1", "user-id-1");

    expect(insertMock).toHaveBeenCalledTimes(1);
    const [, doc] = insertMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(doc).toMatchObject({
      action: "LOGIN_SUCCESS",
      entity: "user",
      entityId: "user-id-1",
      userId: "user-id-1",
    });
    expect(doc.timestamp).toBeInstanceOf(Date);
  });

  it("monta LOGIN_FAILED sem userId quando o e-mail não existe", async () => {
    await record("LOGIN_FAILED", "user", undefined, undefined);

    const [, doc] = insertMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(doc.userId).toBeUndefined();
    expect(doc.entityId).toBeUndefined();
    expect(doc.action).toBe("LOGIN_FAILED");
  });

  it("registra PRICE_UPDATE com oldValue/newValue em metadata", async () => {
    await record("PRICE_UPDATE", "product", "prod-1", "admin-1", {
      field: "preco.preco_venda",
      oldValue: 129.9,
      newValue: 119.9,
    });

    const [, doc] = insertMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(doc.metadata).toEqual({
      field: "preco.preco_venda",
      oldValue: 129.9,
      newValue: 119.9,
    });
  });

  it("não propaga erro quando a gravação falha (não bloqueia a operação principal)", async () => {
    insertMock.mockRejectedValueOnce(new Error("db down"));

    await expect(
      record("LOGIN_FAILED", "user", undefined, undefined),
    ).resolves.toBeUndefined();
  });
});
