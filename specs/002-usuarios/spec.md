# Spec 002 — Usuários e Perfis de Acesso (RBAC)

**Domínio:** Users
**Fase:** 1 — Backoffice
**Status:** Draft
**Depende de:** [001-autenticacao](../001-autenticacao/spec.md)

## 1. Visão geral

Administração de contas de usuário do backoffice e controle de acesso baseado em perfis
(RBAC), restrito a administradores.

## 2. Perfis de acesso

### ADMIN
Pode: criar usuários; editar usuários; desativar usuários; alterar perfis; cadastrar
produtos; editar produtos; excluir logicamente produtos; administrar categorias; alterar
preços; publicar produtos; visualizar auditoria.

### OPERADOR (operator)
Pode: cadastrar produtos; utilizar cadastro por IA; editar produtos; fazer upload de
imagens; alterar estoque; alterar preço; publicar produto.
Não pode: criar usuários; alterar permissões; consultar configurações sensíveis.

### CONSULTA (viewer)
Pode: consultar produtos; consultar catálogo; visualizar estoque.
Não pode alterar dados.

## 3. Modelo de dados

Collection `users`:

```json
{
  "_id": "ObjectId",
  "name": "Maria Silva",
  "email": "maria@example.com",
  "passwordHash": "...",
  "role": "operator",
  "status": "active",
  "lastLoginAt": null,
  "createdAt": "ISODate",
  "updatedAt": "ISODate",
  "createdBy": "ObjectId"
}
```

`role` ∈ {`admin`, `operator`, `viewer`}. `status` ∈ {`active`, `inactive`, `blocked`}.
Índice único em `email`.

## 4. Tela — Administração → Usuários

Listagem com busca por nome/e-mail, colunas Nome/E-mail/Perfil/Status, ação "+ Novo usuário".

## 5. Criação de usuário

Campos: nome, e-mail, senha temporária, confirmação de senha, perfil, status.

Regras: e-mail obrigatório e único; senha mínima de 8 caracteres; perfil obrigatório;
usuário criado inicialmente `active`; `createdBy` registra o administrador responsável.

## 6. Gestão de usuários

Administrador pode: criar, visualizar, editar, ativar, desativar, bloquear, alterar perfil,
resetar senha. **Não realizar exclusão física** — usar `status = inactive`
(constituição, princípio VIII).

## 7. API

```
GET    /api/users
GET    /api/users/:id
POST   /api/users
PATCH  /api/users/:id
PATCH  /api/users/:id/status
PATCH  /api/users/:id/password
```

Todo o módulo é restrito a `role = admin`.

## 8. Autorização — exemplos de referência

```
DELETE /users/:id        → exige role = admin
POST   /products          → aceita role ∈ {admin, operator}
```

## 9. Critérios de aceite

**Administrador**
DADO um usuário `admin`, QUANDO acessar Administração → Usuários, ENTÃO poderá: consultar,
criar, editar, ativar, desativar, alterar perfil, resetar senha.

**Operador tentando acessar administração**
DADO um usuário `operator`, QUANDO tentar acessar `/admin/users`, ENTÃO deve receber
`403 Forbidden` e a página deve permanecer inacessível também no frontend (não apenas
escondida via UI — a rota client-side deve bloquear o acesso).

## 10. Fora de escopo

Múltiplos perfis simultâneos por usuário, permissões granulares por recurso (além dos três
perfis fixos) — evolução futura.

## 11. Conformidade constitucional

Implementa o RBAC do princípio VII e a exclusão lógica do princípio VIII da
[constituição](../../memory/constitution.md). Toda mutação (`USER_CREATE`, `USER_UPDATE`,
`USER_DISABLE`) deve gerar auditoria conforme [008-auditoria](../008-auditoria/spec.md).
