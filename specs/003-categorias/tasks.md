# Tasks 003 — Categorias

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Depende de:** [001-autenticacao/tasks.md](../001-autenticacao/tasks.md),
[002-usuarios/tasks.md](../002-usuarios/tasks.md) (usa `authorize.middleware.ts`)
**Convenção:** `[P]` = tarefa paralelizável.

**Decisão registrada durante a implementação (ADR-007 em `memory/decisions.md`)**: a spec
(seção 2/5) e o `memory/glossary.md` (versão anterior) divergiam sobre onde vive
`department` — seguida a spec ao pé da letra: campo obrigatório de `categories`, não do
produto. `memory/glossary.md` corrigido.

## Fase 1 — Testes

- [x] T001 [P] Teste unitário `backend/src/services/category.service.test.ts`:
      `assertCategoryActive` lança erro para código inexistente e para código inativo;
      `code` duplicado é rejeitado na criação. 5 casos cobertos.
- [x] T002 Teste de integração `backend/tests/integration/categories.spec.ts`:
      `POST /api/categories` com `code` duplicado retorna erro; `GET /api/categories` reflete
      apenas categorias ativas quando filtrado; `POST`/`PATCH` exigem `role=admin`. 9 casos
      cobertos (inclui `active=false`, que pegou o bug do ADR-008).

## Fase 2 — Implementação core (backend)

- [x] T003 [P] Implementar `backend/src/schemas/category.schema.ts`
      (`CategorySchema`, `CreateCategorySchema` — `code` normalizado (trim+uppercase) e
      validado em regex maiúsculo 3–6 chars).
- [x] T004 Implementar `backend/src/repositories/category.repository.ts`
      (`findByCode`, `findById`, `list`, `create`, `updateProfile`, `updateStatus`, índice
      único em `code` via `mongo.client.ts`/`ensureIndexes`) — depende de T003.
- [x] T005 Implementar `backend/src/services/category.service.ts`
      (`assertCategoryActive(code)`, regra de `code` único) — depende de T004 — faz T001
      passar.
- [x] T006 Implementar `backend/src/routes/category.routes.ts` (`GET` com `authenticate`;
      `POST`/`PATCH`/`PATCH .../status` com `authorize(["admin"])` de 002) — depende de T005
      — faz T002 passar.
- [x] T007 Registrar `backend/src/modules/category.module.ts` no `server.ts` (via `app.ts`).
- [x] T008 Script de seed único `backend/src/scripts/seed-categories.ts` (`npm run
      seed:categories`, idempotente) com o catálogo de referência: BERM, CALC, CAMI, POLO,
      VEST, JAQU, BLUS, SAIA, SAPT, BOLS, ACES — depende de T004. Rodado contra o Mongo de
      dev real: 11 criadas na primeira execução, 0 na segunda (idempotência confirmada).

**Bug real encontrado e corrigido testando no navegador** (não pelos testes automatizados):
`ListCategoriesQuerySchema` usava `z.coerce.boolean()` para o filtro `?active=`, que trata
qualquer string não vazia (inclusive `"false"`) como `true` — `active=false` não filtrava
nada. Corrigido com `z.enum(["true","false"]).transform(...)`; ver ADR-008.

## Fase 3 — Integração cross-spec

- [x] T009 Integrar `audit-log.service.record("CATEGORY_CREATE" | "CATEGORY_UPDATE" |
      "CATEGORY_DISABLE", ...)` em `category.service.ts` — depende de T005 e de
      [008-auditoria/tasks.md](../008-auditoria/tasks.md).

## Fase 4 — Frontend

- [x] T010 [P] Implementar `frontend/src/schemas/category.schema.ts` (`CategorySchema`,
      `CreateCategoryFormSchema`, `EditCategoryFormSchema`).
- [x] T011 [P] Implementar `frontend/src/services/category.service.ts` (`/api/categories`).
- [x] T012 Implementar `frontend/src/hooks/useCategories.ts` (TanStack Query — reutilizado
      como fonte de opções em 005/006) — depende de T011.
- [x] T013 Implementar `frontend/src/pages/admin/CategoriesPage.tsx` — depende de T010, T012.
      Formulário de criação inline + edição inline por linha da tabela (sem página separada
      de edição, diferente de 002/UserFormPage — categoria tem só 2 campos editáveis).

**Validado com Playwright contra o app real** (backend + `vite dev`, banco de dev real):
login admin → "Categorias" → lista as 11 do seed → criar categoria nova (`code` minúsculo
normalizado para maiúsculo) → editar nome inline → desativar (exclusão lógica confirmada:
categoria continua no banco, só `active: false`) → recarregar a página confirma o novo
status persistido.

## Dependências entre tarefas

```
T003 → T004 → T005 → T006 → T007
T004 → T008
T005 → T009 (requer 008-auditoria)
T010,T011 → T012 → T013
```

## Nota crítica

`category.service.assertCategoryActive` (T005) é a **fronteira que impede a IA de inventar
categorias fora da taxonomia permitida** (constituição, princípio I). É consumida
diretamente por [004-sku](../004-sku/tasks.md), [005](../005-produtos-cadastro-manual/tasks.md)
e [006](../006-produtos-cadastro-ia/tasks.md) — não deve ser reimplementada nesses módulos.
