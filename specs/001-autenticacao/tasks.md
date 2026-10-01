# Tasks 001 — Autenticação

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Convenção:** `[P]` = tarefa paralelizável (arquivo independente, sem dependência de outra
tarefa em andamento). Tarefas sem `[P]` devem respeitar a ordem listada.

## Fase 1 — Setup

- [x] T001 Criar conexão singleton com MongoDB Atlas em `backend/src/database/mongo.client.ts`
      (lê `MONGODB_URI`, exporta `getDb()`). Implementado junto com o núcleo de
      [008-auditoria](../008-auditoria/tasks.md) (T005), que já depende deste módulo.
- [x] T002 [P] Registrar `@fastify/cookie` em `backend/src/plugins/cookie.plugin.ts`.
- [x] T003 [P] Registrar `@fastify/rate-limit` (global, sem limite específico ainda) em
      `backend/src/plugins/rate-limit.plugin.ts`.

## Fase 2 — Testes (escrever antes da implementação)

- [x] T004 [P] Teste unitário `backend/src/services/password.service.test.ts`: hash gera valor
      diferente da senha original; `verifyPassword` aceita a senha correta e rejeita incorreta.
- [x] T005 [P] Teste unitário `backend/src/services/auth.service.test.ts`: credenciais
      corretas autenticam; senha incorreta e e-mail inexistente retornam o mesmo erro
      genérico; usuário `inactive`/`blocked` não autentica. 5 casos cobertos.
- [x] T006 Teste de integração `backend/tests/integration/auth.spec.ts` (Fastify + MongoDB
      em memória via `mongodb-memory-server`): `POST /api/auth/login` sucesso emite cookies;
      falha não revela existência do e-mail; usuário `inactive` não autentica; `GET /api/auth/me`
      retorna 401 sem cookie válido e 200 com cookie válido. Exigiu separar `app.ts`
      (`buildApp()`) de `server.ts` (bootstrap + listen) para permitir `inject()` nos testes.

## Fase 3 — Implementação core (faz os testes da Fase 2 passarem)

- [x] T007 [P] Implementar `backend/src/schemas/auth.schema.ts`
      (`LoginInputSchema`, `AuthMeOutputSchema`).
- [x] T008 [P] Implementar `backend/src/services/password.service.ts`
      (`hashPassword`, `verifyPassword` com Argon2id) — faz T004 passar. Reaproveitado por
      `scripts/seed-admin.ts` (ADR-004).
- [x] T009 Implementar `backend/src/repositories/user.repository.ts`
      (`findByEmail`, `updateLastLogin`) — depende de T001. Também inclui `findById`
      (necessário para `refresh()` resolver o usuário a partir do `sub` do refresh token —
      não previsto no plan.md original, mas indispensável para T010).
- [x] T010 Implementar `backend/src/services/auth.service.ts`
      (`verifyCredentials`, `issueTokens`, `refresh`) — depende de T007, T008, T009 — faz
      T005 passar. JWT via `jsonwebtoken` (HS256); access token carrega
      `{sub, role, name, email}` (evita round-trip ao Mongo em toda rota autenticada), refresh
      token só `{sub}`. Rotação simples: `refresh()` reemite os dois tokens a cada uso.
- [x] T011 Implementar `backend/src/middleware/authenticate.middleware.ts`
      (popula `request.user` a partir do access token no cookie) — depende de T010. Decora
      `fastify.authenticate` como `preHandler` reutilizável.
- [x] T012 Implementar `backend/src/routes/auth.routes.ts`
      (`POST /login`, `POST /logout`, `POST /refresh`, `GET /me`) — depende de T010, T011 —
      faz T006 passar.
- [x] T013 Aplicar `@fastify/rate-limit` especificamente em `POST /api/auth/login` (10/min) —
      depende de T003, T012.
- [x] T014 Registrar `backend/src/modules/auth.module.ts` no bootstrap do servidor
      (`backend/src/server.ts`) — depende de T012.

## Fase 4 — Integração cross-spec

- [x] T015 Integrar `audit-log.service.record("LOGIN_SUCCESS" | "LOGIN_FAILED", ...)` dentro
      de `auth.service.ts` — depende de T010 e de
      [008-auditoria/tasks.md](../008-auditoria/tasks.md) (T00x de `audit-log.service.ts`).
      Validado contra o cluster de dev real: login correto grava `LOGIN_SUCCESS`; senha errada
      e e-mail inexistente gravam `LOGIN_FAILED` (o segundo sem `userId`/`entityId`).

**Fases 1–4 validadas de ponta a ponta contra o MongoDB Atlas de dev real** (não só o
`mongodb-memory-server` dos testes automatizados): `npm run seed:admin` criou o admin,
`POST /login` → `GET /me` → `POST /logout` → `GET /me` (401) funcionaram via curl contra o
servidor real, e os registros de auditoria foram conferidos direto na collection
`audit_logs`.

## Fase 5 — Frontend

- [x] T016 [P] Implementar `frontend/src/schemas/auth.schema.ts` (`LoginFormSchema`, espelha
      T007). Inclui também `AuthUserSchema`, usado para validar em runtime a resposta de
      `GET /me`.
- [x] T017 [P] Implementar `frontend/src/services/auth.service.ts` (chamadas para
      `/api/auth/*`). `credentials: "include"` em toda chamada; `ApiError` para mensagens
      vindas do envelope `{success:false, error}`; `me()` retorna `null` em 401 em vez de
      lançar.
- [x] T018 Implementar `frontend/src/hooks/useAuth.ts` (TanStack Query sobre `GET /me`) —
      depende de T017. `login`/`logout` como mutations que atualizam o cache de `["auth","me"]`
      via `setQueryData`, sem precisar de refetch.
- [x] T019 Implementar `frontend/src/pages/LoginPage.tsx` (React Hook Form + Zod, exibição de
      erro genérico) — depende de T016, T017. Redireciona para `location.state.from` após
      login (ou `/`), e já redireciona sozinha se acessada com sessão ativa.
- [x] T020 Implementar `frontend/src/app/routes/ProtectedRoute.tsx` (redireciona para
      `/login` quando sessão inválida) — depende de T018.

Roteamento básico ligado em `frontend/src/app/App.tsx` (`BrowserRouter`, rota `/login` e `/`
protegida) — não previsto como task própria, mas necessário para T019/T020 funcionarem; a home
atrás do `ProtectedRoute` é um placeholder até 009-dashboard existir.

**Validado com Playwright contra o app real rodando** (backend + `vite dev`, não só
`tsc`/`eslint`): acessar `/` deslogado redireciona para `/login`; senha errada mostra "E-mail
ou senha inválidos."; login correto com `admin@example.com` redireciona para `/` e exibe
"Olá, Administrador (admin)."; botão Sair volta para `/login`. Sem erros de console além dos
401 esperados da checagem de sessão.

## Fase 6 — E2E

- [x] T021 Teste E2E "login completo até o dashboard" — implementado em
      `e2e/tests/dashboard.spec.ts` junto com
      [009-dashboard/tasks.md, T013](../009-dashboard/tasks.md) (mesmo cenário: login → `/` →
      dashboard renderiza os 6 indicadores sem erro). Desbloqueado com a conclusão de
      009-dashboard.

## Dependências entre tarefas

```
T001 → T009 → T010 → T011 → T012 → T013 → T014
T007,T008 → T010
T010 → T015 (requer audit-log.service de 008)
T016,T017 → T018 → T020
T016,T017 → T019
T012 + T019 + T020 → T021
```
