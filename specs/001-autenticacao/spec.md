# Spec 001 — Autenticação

**Domínio:** Authentication
**Fase:** 1 — Backoffice
**Status:** Draft
**Depende de:** —

## 1. Visão geral

Permitir que usuários cadastrados autentiquem-se no sistema com e-mail e senha, recebendo uma
sessão segura que os leva ao dashboard administrativo.

## 2. User story

Como usuário do backoffice, quero entrar com e-mail e senha para acessar as funcionalidades
do meu perfil, sem que minhas credenciais fiquem expostas a riscos desnecessários.

## 3. Tela de login

Campos: e-mail, senha, botão "Entrar", área de exibição de erros de autenticação.
Recuperação de senha é funcionalidade futura (fora do MVP).

## 4. Fluxo

```
Login → POST /auth/login → valida usuário → valida senha → gera sessão → cookie seguro → dashboard
```

## 5. API

```
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh
GET  /api/auth/me
```

## 6. Regras de negócio

- Senha é validada contra hash **Argon2id** — nunca comparação em texto puro.
- Sessão usa Access Token + Refresh Token, preferencialmente em cookies `HttpOnly`, `Secure`
  (produção), `SameSite`. Não usar `localStorage` para tokens sensíveis.
- Falha de autenticação (usuário inexistente ou senha incorreta) retorna sempre a mesma
  mensagem genérica — nunca revela se o e-mail existe.
- Toda tentativa de login (sucesso ou falha) é registrada em `audit_logs`
  (`LOGIN_SUCCESS` / `LOGIN_FAILED`), ver [008-auditoria](../008-auditoria/spec.md).
- `POST /api/auth/login` é protegido por rate limiting para mitigar brute force
  (ver constituição, princípio VII).
- Usuários com `status` diferente de `active` (`inactive`, `blocked`) não conseguem
  autenticar.

## 7. Critérios de aceite

**Login válido**
DADO um usuário ativo, QUANDO informar e-mail e senha corretos, ENTÃO deve ser autenticado e
levado ao dashboard.

**Login inválido**
DADO um usuário, QUANDO informar credenciais incorretas, ENTÃO o sistema deve: não autenticar;
não revelar se o e-mail existe; registrar a tentativa; apresentar mensagem genérica.

## 8. Fora de escopo

Recuperação/reset de senha autoatendido, login social, MFA — evoluções futuras.

## 9. Conformidade constitucional

Atende aos princípios VII (segurança por padrão) e IX (auditoria) da
[constituição](../../memory/constitution.md).
