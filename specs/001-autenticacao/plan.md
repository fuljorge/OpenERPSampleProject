# Plan 001 — Autenticação

**Spec:** [spec.md](spec.md)
**Constituição:** [memory/constitution.md](../../memory/constitution.md)

## 1. Stack técnica (seção 4 da especificação original)

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + TypeScript + Fastify |
| Sessão | `@fastify/cookie` (cookies `HttpOnly`, `Secure`, `SameSite`) |
| Hash de senha | Argon2id (`argon2`) |
| Tokens | JWT — Access Token + Refresh Token (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) |
| Rate limit | `@fastify/rate-limit` em `/auth/login` |
| Validação | Zod (contrato de entrada/saída) |
| Banco | MongoDB Atlas (driver oficial), collection `users` |
| Frontend | React + Vite 8 + TypeScript + React Router + React Hook Form + Zod + TanStack Query |

## 2. Contexto técnico

Módulo transversal: toda rota autenticada depende deste domínio. Não introduzir Redis para
sessão nesta fase (constituição, princípio V) — Refresh Token validado contra hash/expiração
armazenados via JWT assinado, sem necessidade de store externo no MVP.

## 3. Estrutura de arquivos

```
backend/src/
├── database/mongo.client.ts            # conexão única MongoDB Atlas (client compartilhado)
├── plugins/cookie.plugin.ts            # @fastify/cookie
├── plugins/rate-limit.plugin.ts        # @fastify/rate-limit
├── schemas/auth.schema.ts              # LoginInputSchema, AuthMeOutputSchema (Zod)
├── repositories/user.repository.ts     # findByEmail, updateLastLogin
├── services/auth.service.ts            # verifyCredentials, issueTokens, refresh
├── services/password.service.ts        # hash/verify Argon2id
├── middleware/authenticate.middleware.ts  # lê cookie, valida access token
├── routes/auth.routes.ts               # POST /login, /logout, /refresh, GET /me
└── modules/auth.module.ts              # registra plugin de rotas no server.ts

frontend/src/
├── schemas/auth.schema.ts              # LoginFormSchema (Zod, espelha o backend)
├── services/auth.service.ts            # chamadas fetch/axios para /api/auth/*
├── hooks/useAuth.ts                    # estado de sessão via TanStack Query (GET /me)
├── pages/LoginPage.tsx
└── app/routes/ProtectedRoute.tsx       # guarda de rota client-side por sessão válida
```

`shared/schemas/auth.schema.ts` pode hospedar o schema de login se for reaproveitado
literalmente por frontend e backend (a definir na implementação — evitar duplicação apenas
quando o contrato for idêntico).

## 4. Fluxo de execução (camadas)

```
LoginPage (React Hook Form + Zod)
  → auth.service.ts (POST /api/auth/login)
  → routes/auth.routes.ts (Fastify)
  → schemas/auth.schema.ts (valida body)
  → services/auth.service.ts (busca usuário, verifica senha, gera tokens)
  → repositories/user.repository.ts (MongoDB)
  → cookies HttpOnly/Secure/SameSite na resposta
  → audit_logs (LOGIN_SUCCESS | LOGIN_FAILED), ver 008-auditoria
```

## 5. Passos de implementação

1. `database/mongo.client.ts`: conexão singleton ao MongoDB Atlas via `MONGODB_URI`.
2. `schemas/auth.schema.ts`: `LoginInputSchema` (email, senha), `AuthMeOutputSchema`.
3. `services/password.service.ts`: `hashPassword`, `verifyPassword` (Argon2id).
4. `repositories/user.repository.ts`: `findByEmail(email)`.
5. `services/auth.service.ts`: orquestra verificação de credenciais + emissão de tokens;
   mensagem de erro sempre genérica (não revela existência do e-mail).
6. `middleware/authenticate.middleware.ts`: decorator Fastify `onRequest` que popula
   `request.user` a partir do cookie de access token; usado por toda rota protegida
   (inclusive as de 002 a 009).
7. `routes/auth.routes.ts`: `POST /login`, `POST /logout`, `POST /refresh`, `GET /me`.
8. Registrar `@fastify/rate-limit` especificamente em `/api/auth/login`.
9. Integração com auditoria: chamar serviço de auditoria em toda tentativa de login.
10. Frontend: `LoginPage` com RHF + Zod, `useAuth` hook, `ProtectedRoute` que redireciona
    para `/login` quando `GET /me` falha.

## 6. Testes planejados

- Unitário: `password.service` (hash/verify), `auth.service` (credenciais corretas/incorretas,
  usuário `inactive`/`blocked`).
- Integração: Fastify + MongoDB — `POST /login` sucesso/falha, `GET /me` com/sem cookie válido.
- E2E: fluxo de login completo até o dashboard (depende de 009-dashboard).

## 7. Riscos / decisões em aberto

- Estratégia de invalidação de refresh token (rotação vs. lista de revogação) — decidir na
  implementação; nesta fase, sem Redis, considerar rotação simples com reemissão a cada uso.
