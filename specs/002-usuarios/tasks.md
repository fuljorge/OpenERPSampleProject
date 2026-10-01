# Tasks 002 — Usuários e RBAC

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Depende de:** [001-autenticacao/tasks.md](../001-autenticacao/tasks.md)
**Convenção:** `[P]` = tarefa paralelizável.

## Fase 1 — Testes (escrever antes da implementação)

- [x] T001 [P] Teste unitário `backend/src/middleware/authorize.middleware.test.ts`:
      `authorize(["admin"])` permite `role=admin` e rejeita `operator`/`viewer` com 403.
      5 casos cobertos.
- [x] T002 [P] Teste unitário `backend/src/services/user.service.test.ts`: e-mail duplicado
      é rejeitado; senha com menos de 8 caracteres é rejeitada; usuário criado como
      `status=active` com `createdBy` preenchido. 7 casos cobertos (inclui status explícito
      e transições USER_UPDATE/USER_DISABLE de `updateUserStatus`).
- [x] T003 Teste de integração `backend/tests/integration/users.spec.ts`: `POST /api/users`
      cria usuário com hash Argon2id; `PATCH /api/users/:id/status` nunca remove fisicamente
      o documento; `operator` recebe 403 em qualquer rota de `/api/users`.

## Fase 2 — Implementação core (backend)

- [x] T004 [P] Implementar `backend/src/middleware/authorize.middleware.ts`
      (`authorize(roles: Role[])`, reutilizável por todos os módulos) — faz T001 passar.
- [x] T005 [P] Implementar `backend/src/schemas/user.schema.ts`
      (`CreateUserSchema`, `UpdateUserSchema`, `UserSchema`, mais `UpdateStatusSchema`,
      `UpdatePasswordSchema` e `ListUsersQuerySchema` para as demais rotas). `status` no
      `CreateUserSchema` é opcional (default `active` aplicado no service).
- [x] T006 Estender `backend/src/repositories/user.repository.ts` (de 001) com `create`
      (já existia, do ADR-004), `list` (busca por nome/e-mail via regex escapado),
      `updateStatus`, `updatePassword` — depende de 001/T009. `updateRole` consolidado em
      `updateProfile(name?, role?)` em vez de método separado (mais simples, mesmo efeito).
      `User` ganhou `lastLoginAt/createdAt/updatedAt/createdBy` (faltavam para a listagem).
- [x] T007 Implementar `backend/src/services/user.service.ts` (valida e-mail único, aplica
      `createdBy`, reutiliza `password.service.ts` de 001) — depende de T005, T006 — faz
      T002 passar. Também valida senha mínima defensivamente no service (não só no schema).
- [x] T008 Implementar `backend/src/routes/user.routes.ts` (6 rotas, todas com
      `authenticate` + `authorize(["admin"])`) — depende de T004, T007 — faz T003 passar.
- [x] T009 Registrar `backend/src/modules/user.module.ts` no `server.ts` (via `app.ts`).

## Fase 3 — Integração cross-spec

- [x] T010 Integrar `audit-log.service.record("USER_CREATE" | "USER_UPDATE" |
      "USER_DISABLE", ...)` em `user.service.ts` — depende de T007 e de
      [008-auditoria/tasks.md](../008-auditoria/tasks.md). Validado contra o Mongo de dev
      real: criar usuário grava `USER_CREATE`, desativar grava `USER_DISABLE` com
      `oldValue`/`newValue`.

**Lacuna fechada durante a implementação**: não existia índice único em `users.email` no
Atlas (só o `_id_` padrão), apesar de exigido pela constituição (princípio X). Adicionado
`ensureIndexes()` em `database/mongo.client.ts`, chamado a cada `connectMongo()` (idempotente).

**Fases 1–3 validadas de ponta a ponta contra o MongoDB Atlas de dev real**: login como
admin → listar usuários → criar operadora (hash Argon2id conferido direto no Mongo) →
e-mail duplicado rejeitado (400) → operadora loga e recebe 403 em `/api/users` → admin
desativa a operadora → operadora não consegue mais logar (401) → `audit_logs` confirma
`USER_CREATE` e `USER_DISABLE` com os metadados corretos.

## Fase 4 — Frontend

Tailwind CSS configurado nesta fase (`@tailwindcss/vite`, CSS-first v4 — sem
`tailwind.config.js`) — decisão pendente desde a análise da spec, primeira vez que o projeto
precisava de componentes visuais reais.

- [x] T011 [P] Implementar `frontend/src/schemas/user.schema.ts` — `CreateUserFormSchema`
      (com `confirmPassword`, `.refine` de senhas iguais) e `EditUserFormSchema` (name+role),
      em vez de um único `UserFormSchema` (criação e edição têm campos bem diferentes).
- [x] T012 [P] Implementar `frontend/src/services/user.service.ts` (`/api/users/*`).
- [x] T013 [P] Implementar `frontend/src/components/Table.tsx` (reutilizável — também usado
      em 005).
- [x] T014 [P] Implementar `frontend/src/components/Badge.tsx` (status ativo/inativo/
      bloqueado).
- [x] T015 Implementar `frontend/src/hooks/useUsers.ts` (list + mutations via TanStack
      Query) — depende de T012.
- [x] T016 Implementar `frontend/src/components/UserForm.tsx` (RHF + Zod) — depende de T011.
      Dois subcomponentes internos (`CreateUserForm`/`EditUserForm`, cada um com seu próprio
      `useForm`) por trás de um único `UserForm` que escolhe pelo `mode`.
- [x] T017 Implementar `frontend/src/pages/admin/UsersPage.tsx` (listagem + busca) —
      depende de T013, T014, T015. Inclui coluna de ações com atalho para ativar/desativar
      direto da lista, além do link "Editar".
- [x] T018 Implementar `frontend/src/pages/admin/UserFormPage.tsx` (criação/edição) —
      depende de T016, T015. Modo decidido por `useParams<{id?: string}>()` — sem `:id` é
      criação (`/admin/users/new`), com `:id` é edição.
- [x] T019 Bloquear rota `/admin/users` no client-side para perfis diferentes de `admin` —
      depende de T017, T018. `ProtectedRoute` (001) ganhou uma prop opcional `roles`, em vez
      de um componente novo — não-admin autenticado que acessa a URL direto é redirecionado
      para `/`.

**Validado com Playwright contra o app real** (backend + `vite dev`): login admin →
"Administração → Usuários" → lista renderizada com Tailwind (tabela + badges coloridos) →
criar usuário via formulário (senha + confirmação) → usuário aparece na lista → editar nome/
perfil de outro usuário → mudança refletida na lista → logout → login como o usuário recém-
criado (operator) → acesso direto a `/admin/users` por URL é bloqueado e redireciona para `/`.

## Fase 5 — E2E

Infraestrutura de E2E criada nesta fase: `e2e/` na raiz do projeto (Playwright Test),
orquestra backend + frontend via `webServer`, roda contra o **cluster de teste dedicado do
Atlas** (não dev, não `mongodb-memory-server`), com `global-setup.ts` garantindo o admin de
fixture de forma idempotente (reaproveitando os módulos reais do backend, mesmo espírito do
`seed-admin.ts`/ADR-004). Ver `e2e/AGENTS.md` para convenções específicas de E2E.

- [x] T020 Teste E2E "criação e alteração de usuário por admin" — depende de T008–T019.
      `e2e/tests/user-management.spec.ts`.
- [x] T021 Teste E2E "acesso negado (403) para operador em /admin/users" (front e back) —
      depende de T008, T019. `e2e/tests/user-access-control.spec.ts` — testa o redirect do
      frontend E a API direto via `page.request` (mesmos cookies da sessão), não só a UI.

**Rodado de verdade contra o cluster de teste real** (`npx playwright test` em `e2e/`): 2/2
specs passando.

## Dependências entre tarefas

```
T004,T005 → T007 (T006 também necessário)
T007 → T008 → T009
T007 → T010 (requer 008)
T011,T012 → T015,T016
T013,T014,T015 → T017
T016,T015 → T018
T017,T018 → T019 → T020,T021
```
