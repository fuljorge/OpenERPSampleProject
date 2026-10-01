import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AuditActionEnum } from "./audit-log.schema.js";

/**
 * O frontend tem uma cópia própria do enum de ações (não importa do backend). Se ela ficar para trás,
 * o `z.enum` do frontend rejeita a listagem inteira assim que existir um registro com a ação nova — a
 * tela de Auditoria fica em "Carregando..." para sempre. Este teste lê os arquivos do frontend como
 * texto (o backend não pode importá-los) e compara.
 */
function literalsFrom(source: string, pattern: RegExp): string[] {
  const block = pattern.exec(source)?.[1];
  if (!block) throw new Error(`Bloco não encontrado com ${pattern}`);
  return [...block.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
}

const frontendSchema = readFileSync(new URL("../../../frontend/src/schemas/audit-log.schema.ts", import.meta.url), "utf8");
const frontendPage = readFileSync(new URL("../../../frontend/src/pages/admin/AuditLogsPage.tsx", import.meta.url), "utf8");

describe("contrato do enum de ações de auditoria (backend × frontend)", () => {
  it("o enum do frontend tem exatamente as mesmas ações do backend", () => {
    const frontend = literalsFrom(frontendSchema, /AuditActionEnum = z\.enum\(\[([\s\S]*?)\]\)/);

    expect([...frontend].sort()).toEqual([...AuditActionEnum.options].sort());
  });

  it("toda ação do backend tem rótulo na tela de Auditoria", () => {
    const labelled = [...frontendPage.matchAll(/^\s*([A-Z][A-Z_]+):\s*"/gm)].map((m) => m[1]!);

    const missing = AuditActionEnum.options.filter((action) => !labelled.includes(action));
    expect(missing).toEqual([]);
  });
});
