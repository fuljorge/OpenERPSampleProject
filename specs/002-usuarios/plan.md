# Plan 002 — Usuários e RBAC

**Spec:** [spec.md](spec.md)
**Constituição:** [memory/constitution.md](../../memory/constitution.md)
**Depende de:** [001-autenticacao/plan.md](../001-autenticacao/plan.md)

## 1. Stack técnica

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + TypeScript + Fastify |
| Autorização | Middleware Fastify próprio (RBAC), reutiliza `authenticate.middleware.ts` de 001 |
| Hash de senha | Argon2id (`argon2`), reutiliza `password.service.ts` de 001 |
| Validação | Zod |
| Banco | MongoDB Atlas, collection `users`, índice único em `email` |
| Frontend | React + Vite 8 + TypeScript + React Router + React Hook Form + Zod + TanStack Query |

## 2. Contexto técnico

RBAC de 3 perfis fixos (`admin`, `operator`, `viewer`) sem tabela de permissões dinâmica —
implementado como matriz estática em código (constituição, princípio V: simplicidade até
haver necessidade concreta).

## 3. Estrutura de arquivos

```
backend/src/
├── middleware/authorize.middleware.ts   # authorize(["admin"]) — factory de guarda por role
├── schemas/user.schema.ts               # CreateUserSchema, UpdateUserSchema, UserSchema
├── repositories/user.repository.ts      # create, findById, list, updateStatus, updateRole (estende 001)
├── services/user.service.ts             # regras: e-mail único, senha mínima, createdBy
├── routes/user.routes.ts                # GET/POST/PATCH sob authorize(["admin"])
└── modules/user.module.ts

frontend/src/
├── schemas/user.schema.ts               # UserFormSchema (Zod)
├── services/user.service.ts             # chamadas /api/users/*
├── hooks/useUsers.ts                    # TanStack Query (list, mutations)
├── pages/admin/UsersPage.tsx            # listagem + busca
├── pages/admin/UserFormPage.tsx         # criação/edição
├── components/UserForm.tsx
├── components/Table.tsx                 # componente reutilizável (também usado em 005)
└── components/Badge.tsx                 # status do usuário (ativo/inativo/bloqueado)
```

## 4. Matriz de autorização (referência de implementação)

```
GET    /api/users            → admin
GET    /api/users/:id        → admin
POST   /api/users             → admin
PATCH  /api/users/:id         → admin
PATCH  /api/users/:id/status  → admin
PATCH  /api/users/:id/password → admin
```

`authorize.middleware.ts` é aplicado após `authenticate.middleware.ts` em todas as rotas
acima (cadeia: `request → authenticate → authorize(["admin"]) → controller`).

## 5. Passos de implementação

1. `schemas/user.schema.ts`: schemas Zod para criação (nome, e-mail, senha temporária,
   confirmação, perfil, status) e atualização parcial.
2. `repositories/user.repository.ts`: estender repositório de 001 com `create`, `list`
   (busca por nome/e-mail), `updateStatus`, `updateRole`, `updatePassword`.
3. `services/user.service.ts`: valida e-mail único (índice + checagem prévia), aplica
   `createdBy` a partir de `request.user`, define `status = active` na criação.
4. `middleware/authorize.middleware.ts`: função `authorize(roles: Role[])` reutilizável por
   todos os módulos (também usada em 003, 005 para restringir a `admin`/`operator`).
5. `routes/user.routes.ts`: registra as 6 rotas com `authorize(["admin"])`.
6. Toda mutação dispara auditoria (`USER_CREATE`, `USER_UPDATE`, `USER_DISABLE`) — ver
   [008-auditoria](../008-auditoria/plan.md).
7. Frontend: `UsersPage` (tabela + busca), `UserFormPage` (criar/editar), rota protegida por
   `authorize` client-side equivalente (esconder e bloquear `/admin/users` para não-admin).

## 6. Testes planejados

- Unitário: `user.service` (e-mail duplicado, senha curta, transições de status), matriz de
  `authorize.middleware`.
- Integração: `POST /users` cria usuário `active` com hash Argon2id; `PATCH .../status` não
  permite exclusão física.
- E2E: criação e alteração de usuário por admin; acesso negado (`403`) para operador em
  `/admin/users` (front e back).

## 7. Riscos / decisões em aberto

- Reset de senha nesta fase é feito pelo admin (`PATCH /:id/password`), sem fluxo de
  autoatendimento por e-mail — fora do MVP conforme 001.
