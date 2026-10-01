# Tasks 008 — Auditoria

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Depende de:** [001-autenticacao/tasks.md](../001-autenticacao/tasks.md),
[002-usuarios/tasks.md](../002-usuarios/tasks.md) (`authorize.middleware.ts`)
**Convenção:** `[P]` = tarefa paralelizável.

**Prioridade de implementação:** este módulo deve ser concluído **antes** (ou em paralelo
imediato com) 001–006, já que todos eles chamam `audit-log.service.record()`.

## Fase 1 — Testes

- [x] T001 [P] Teste unitário `backend/src/services/audit-log.service.test.ts`: `record()`
      monta o documento correto (`userId`, `action`, `entity`, `entityId`, `timestamp`,
      `metadata`) para cada tipo de ação do enum. 4 casos cobertos (sucesso, sem userId,
      metadata de preço, falha não propagada).
- [x] T002 Teste de integração `backend/tests/integration/audit-logs.spec.ts`: login falho
      gera `LOGIN_FAILED`; alteração de preço gera `PRICE_UPDATE` com `oldValue`/`newValue`;
      `operator` recebe 403 em `GET /api/audit-logs`. `PRICE_UPDATE` testado chamando
      `record()` diretamente (produto ainda não existe como domínio — 003/005 não
      implementadas). 6 casos cobertos.

## Fase 2 — Implementação core

- [x] T003 [P] Implementar `backend/src/schemas/audit-log.schema.ts`
      (`AuditActionEnum` com os 14 valores da spec — a spec lista 14, não 13 —,
      `AuditLogSchema`).
- [x] T004 Implementar `backend/src/repositories/audit-log.repository.ts` (apenas `insertOne`
      e `find` — nenhum `updateOne`/`deleteOne` exposto, reforçando imutabilidade na camada
      de dados) — depende de T003.
- [x] T005 Implementar `backend/src/services/audit-log.service.ts` (`record(action, entity,
      entityId, userId, metadata?)`; falha de gravação é logada e **não** interrompe a
      operação de negócio principal) — depende de T004 — faz T001 passar. Requer
      `backend/src/database/mongo.client.ts` (`getDb()`), implementado junto — mesmo arquivo
      previsto como T001 de [001-autenticacao/tasks.md](../001-autenticacao/tasks.md).
- [x] T006 Implementar `backend/src/routes/audit-log.routes.ts`
      (`GET /api/audit-logs`, `authorize(["admin"])`, paginação e filtros por
      entidade/ação/usuário/período) — depende de T005 — faz T002 passar. Resposta validada
      com `AuditLogListResultSchema.parse()` (mesmo padrão de `GET /me`, 001).
- [x] T007 Registrar `backend/src/modules/audit-log.module.ts` no `server.ts` (via `app.ts`).

**Bug real encontrado e corrigido durante T002**: o driver do MongoDB converte campos
`undefined` em BSON `null` na inserção por padrão, em vez de omitir a chave — quebrava a
semântica de "campo opcional ausente" (`audit_logs.userId` quando a ação não pode ser
atribuída a um usuário). Corrigido com `ignoreUndefined: true` em
`database/mongo.client.ts` (afeta o driver inteiro, não só auditoria — ver ADR-006 em
`memory/decisions.md`). Documentos gravados antes dessa correção continuam com `null`
explícito no banco de dev; `AuditLogOutputSchema` (backend) e `AuditLogEntrySchema`
(frontend) aceitam `null` além de ausente por isso.

## Fase 3 — Frontend

- [x] T008 [P] `frontend/src/services/audit-log.service.ts` (`GET /api/audit-logs`).
- [x] T009 Implementar `frontend/src/hooks/useAuditLogs.ts` — depende de T008.
- [x] T010 Implementar `frontend/src/pages/admin/AuditLogsPage.tsx` (acessível apenas no
      menu de admin) — depende de T009. Filtros por ação/entidade, paginação
      (Anterior/Próxima), link "Auditoria" adicionado ao `AppLayout` (só para admin).

**Validado com Playwright contra o app real** (backend + `vite dev`, banco de dev real com
26 registros históricos acumulados desde 001/002): lista renderiza corretamente (inclusive
registros antigos com `null`), filtro por ação funciona, `operator` tentando acessar
`/admin/audit-logs` direto por URL é bloqueado e redirecionado para `/`.

## Dependências entre tarefas

```
T003 → T004 → T005 → T006 → T007
T008 → T009 → T010
```

## Consumido por

`audit-log.service.record()` (T005) é importado diretamente por:
[001-autenticacao](../001-autenticacao/tasks.md) (T015),
[002-usuarios](../002-usuarios/tasks.md) (T010),
[003-categorias](../003-categorias/tasks.md) (T009),
[005-produtos-cadastro-manual](../005-produtos-cadastro-manual/tasks.md) (T012),
[006-produtos-cadastro-ia](../006-produtos-cadastro-ia/tasks.md) (T010).
