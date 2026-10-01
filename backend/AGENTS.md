# AGENTS.md — backend

Instruções específicas para agentes de IA trabalhando em `backend/`. Complementa o
[`AGENTS.md`](../AGENTS.md) da raiz — leia-o primeiro; princípios da constituição valem aqui
integralmente.

## Stack

Node.js + TypeScript (strict) + Fastify 5 + MongoDB Driver oficial + Zod + Argon2id +
Azure Blob Storage SDK.

## Comandos

```bash
npm run dev       # tsx watch src/server.ts — http://localhost:3333
npm run build      # tsc -p tsconfig.json
npm run start       # node dist/server.js
npm run lint        # eslint .
npm run test        # vitest run
```

Rode `lint` e `test` antes de dar uma tarefa como concluída.

## Estrutura de pastas

```
src/
├── server.ts        # bootstrap do Fastify
├── database/         # conexão MongoDB, índices
├── middleware/        # auth (JWT), autorização (RBAC), rate limit
├── modules/           # ponto de entrada por domínio (auth, users, products, categories...)
├── plugins/            # adapters de integrações externas (ai/, images/) atrás de ports
├── repositories/        # acesso a dados — única camada que fala com o MongoDB Driver
├── routes/              # definição de rotas Fastify (fino: valida → chama service)
├── schemas/              # schemas Zod de request/response por rota
└── services/              # application services — regras de negócio orquestradas aqui
```

## Cadeia de dependência obrigatória

```
routes (Zod valida) → services (application) → domain rules → repositories → MongoDB
```

- `routes/` nunca acessa `repositories/` diretamente nem contém lógica de negócio.
- `repositories/` é a única camada que importa o driver do MongoDB.
- Integrações externas (IA, imagens) só são chamadas através de um port em `plugins/`
  (`AiProviderPort`, `ImageProviderPort`) — nunca importar o SDK de um provedor fora de
  `plugins/`.

## Regras específicas do backend (constituição)

- **SKU**: gerar exclusivamente via `findOneAndUpdate` com `$inc` e `upsert: true` na
  collection `sku_sequences`. Proibido ler o último valor e somar 1 em código de aplicação.
  Formato: `ERP-{CATEGORIA}-{SEQUENCIA:6 dígitos}`.
- **Senhas**: hash com Argon2id (`argon2` package), nunca texto puro nem outro algoritmo.
- **Sessão**: Access Token + Refresh Token; preferir cookies `HttpOnly` + `Secure` (produção) +
  `SameSite`. Evitar guardar tokens sensíveis client-side fora de cookie.
- **RBAC**: toda rota sensível passa por `middleware` de autenticação → `middleware` de
  autorização (perfil `admin`/`operator`/`viewer`) → controller, nessa ordem.
- **Validação**: toda entrada de rota validada por schema Zod em `schemas/`; upload valida
  MIME type, extensão, tamanho e quantidade máxima de arquivos.
- **Rate limiting**: obrigatório em `/auth/login` e `/products/analyze`.
- **CORS** restritivo; segredos só via variáveis de ambiente (`.env`, nunca versionado).
- Falha de login nunca revela se o e-mail existe; toda tentativa é auditada.
- Exclusão lógica: `DELETE` em produtos/usuários seta `status = inativo`/`inactive`, não
  remove o documento.
- Toda operação que altera estado relevante (login, usuários, produtos, preços, categorias)
  grava em `audit_logs` (usuário, ação, entidade, timestamp, valor antigo/novo).
- IA (em `plugins/ai/`) nunca acessa o MongoDB diretamente, nunca gera SKU, nunca decide —
  retorna sugestões estruturadas com `confidence`; campo não determinável = `null`, nunca
  valor inventado.

## Testes

- **Unitários** (`vitest`): gerador de SKU, schemas Zod, regras de produto, regras de usuário,
  permissões (RBAC).
- **Integração**: Fastify + MongoDB, rotas de Auth, Products, Users, SKU sequence.

Use os schemas de `shared/schemas/` quando o contrato for compartilhado com o frontend — não
duplicar a definição Zod localmente.
