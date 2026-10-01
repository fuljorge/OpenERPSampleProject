# Plan 008 — Auditoria

**Spec:** [spec.md](spec.md)
**Constituição:** [memory/constitution.md](../../memory/constitution.md)
**Depende de:** [001-autenticacao/plan.md](../001-autenticacao/plan.md)

## 1. Stack técnica

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + TypeScript + Fastify |
| Validação | Zod |
| Banco | MongoDB Atlas, collection `audit_logs` (append-only) |
| Frontend | React + Vite 8 + TypeScript + TanStack Query (visualização restrita a admin) |

## 2. Contexto técnico

Serviço transversal, consumido por 001, 002, 003, 005 e 006 — implementado uma única vez e
importado pelos demais serviços (nunca reimplementado por módulo).

## 3. Estrutura de arquivos

```
backend/src/
├── schemas/audit-log.schema.ts        # AuditActionEnum, AuditLogSchema
├── repositories/audit-log.repository.ts  # insert (append-only), list (paginado, filtros)
├── services/audit-log.service.ts       # record(action, entity, entityId, userId, metadata?)
├── routes/audit-log.routes.ts          # GET /audit-logs (admin)
└── modules/audit-log.module.ts

frontend/src/
├── services/audit-log.service.ts
├── hooks/useAuditLogs.ts
└── pages/admin/AuditLogsPage.tsx
```

## 4. Integração com os demais domínios

`services/audit-log.service.ts` expõe `record()` e é chamado diretamente pelos serviços de
outros domínios, na mesma operação lógica que originou o evento:

```
auth.service.ts        → record("LOGIN_SUCCESS" | "LOGIN_FAILED", "user", userId?)
user.service.ts         → record("USER_CREATE" | "USER_UPDATE" | "USER_DISABLE", "user", id)
category.service.ts     → record("CATEGORY_CREATE" | "CATEGORY_UPDATE" | "CATEGORY_DISABLE", "category", id)
product.service.ts      → record("PRODUCT_CREATE" | "PRODUCT_UPDATE" | "PRODUCT_DISABLE"
                                  | "PRODUCT_PUBLISH" | "PRODUCT_SOLD" | "PRICE_UPDATE", "product", id, metadata)
```

## 5. Passos de implementação

1. `schemas/audit-log.schema.ts`: enum fechado das ações auditáveis (seção 3 da spec).
2. `repositories/audit-log.repository.ts`: apenas `insertOne`/`find` — nenhum `updateOne`/
   `deleteOne` exposto (imutabilidade garantida também na camada de repositório, não só por
   convenção).
3. `services/audit-log.service.ts`: função única `record()` usada por todos os demais
   serviços; nunca lançar exceção que interrompa a operação de negócio principal em caso de
   falha de auditoria — logar erro internamente e prosseguir (decisão a confirmar com o
   time, ver riscos).
4. `routes/audit-log.routes.ts`: `GET /api/audit-logs` com `authorize(["admin"])`, suporta
   paginação e filtro por entidade/ação/usuário/período.
5. Frontend: `AuditLogsPage` acessível apenas no menu de admin.

## 6. Testes planejados

- Unitário: `audit-log.service.record` monta o documento correto para cada tipo de ação.
- Integração: login falho gera `LOGIN_FAILED`; alteração de preço gera `PRICE_UPDATE` com
  `oldValue`/`newValue`; usuário `operator` recebe `403` em `GET /audit-logs`.

## 7. Riscos / decisões em aberto

- Definir se uma falha ao gravar auditoria deve bloquear a operação de negócio (ex.: impedir
  login se o log falhar) ou apenas ser registrada como erro secundário — a spec não define
  isso explicitamente; recomenda-se **não bloquear** a operação principal, para não acoplar
  disponibilidade do sistema à da auditoria.
