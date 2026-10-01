# Plan 011 — Integração com Marketplaces (Camada de Conectores)

**Spec:** [spec.md](spec.md)
**Constituição:** [memory/constitution.md](../../memory/constitution.md)
**Depende de:** [001-autenticacao/plan.md](../001-autenticacao/plan.md),
[002-usuarios/plan.md](../002-usuarios/plan.md),
[005-produtos-cadastro-manual/plan.md](../005-produtos-cadastro-manual/plan.md),
[008-auditoria/plan.md](../008-auditoria/plan.md)

## 1. Stack técnica

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + TypeScript + Fastify |
| Validação | Zod |
| Criptografia de credenciais | `node:crypto` nativo (AES-256-GCM) — sem dependência nova nesta fase (constituição, princípio V) |
| Banco | MongoDB Atlas — `marketplace_accounts` (contas) + `products.marketplaces` (publicações, embutido no produto) |
| Rate limit | `@fastify/rate-limit` em `/api/marketplace-accounts` (mesmo plugin já usado em `/auth/login`, `/products/analyze`) |
| Frontend | React + Vite 8 + TypeScript + TanStack Query + React Hook Form + Zod |

Explicitamente **não** usar um serviço de segredo gerenciado (ex. Azure Key Vault) nesta fase
— `node:crypto` com envelope encryption (chave-mestra em variável de ambiente + chaves de dados
rotacionáveis no banco — seção 3.1 da spec, ADR-021) é suficiente para o volume/risco atual (constituição, princípio V); reavaliar só se
surgir necessidade real (auditoria externa, trilha de acesso à chave, HSM).

## 2. Contexto técnico

Dois sub-domínios compartilhando um conceito comum (a porta de conector), mas com ciclos de
vida e RBAC diferentes:

1. **Cadastro de contas de marketplace** — CRUD administrativo simples, mesmo padrão de
   [003-categorias](../003-categorias/plan.md), mas com uma camada extra (criptografia da
   credencial) e RBAC mais restrito (admin também no `GET`, spec seção 2.2).
2. **Publicação de produto via conector** — porta + adapter, mesmo padrão de
   [006](../006-produtos-cadastro-ia/plan.md)/[007](../007-imagens/plan.md)
   (`plugins/ai/`, `plugins/images/`). Esta spec define **só a porta**
   (`MarketplaceConnectorPort`) e a orquestração em torno dela; nenhum adapter concreto
   (Mercado Livre, Shopee, eBay) é implementado aqui — cada um vira uma spec própria (012+,
   spec seção 5).

## 3. Estrutura de arquivos

```
shared/schemas/
└── marketplace.schema.ts        # MarketplaceEnum ("mercado_livre"|"shopee"|"ebay"),
                                  # MarketplaceListingSchema (item de products.marketplaces[])
                                  # — importado por product.schema.ts (005)

backend/src/
├── plugins/marketplaces/marketplace-connector.port.ts   # interface: publish(product, account) => {id_anuncio, url_anuncio}
├── schemas/marketplace-account.schema.ts                 # MarketplaceAccountSchema (resposta, sem credential em texto puro), Create/UpdateMarketplaceAccountSchema (entrada, com credential em texto puro)
├── repositories/marketplace-account.repository.ts        # findById, list, create, updateProfile, updateStatus
├── services/credential-encryption.service.ts             # encrypt(plain)/decrypt(ciphertext) — AES-256-GCM
├── services/marketplace-account.service.ts                # regras de negócio + orquestra criptografia + auditoria (MARKETPLACE_ACCOUNT_*)
├── services/marketplace-listing.service.ts                 # publish(productId, marketplace, accountId) — valida produto, chama o conector, grava/upsert em products.marketplaces
├── routes/marketplace-account.routes.ts                    # GET/POST /marketplace-accounts, PATCH /:id, PATCH /:id/status — todas admin + rate limit
├── routes/marketplace-listing.routes.ts                    # POST /products/:id/marketplace-listings
└── modules/marketplace.module.ts                            # registra as duas rotas acima

frontend/src/
├── schemas/marketplace-account.schema.ts     # reexporta de shared/dist + MarketplaceAccountFormSchema
├── services/marketplace-account.service.ts    # /api/marketplace-accounts
├── services/marketplace-listing.service.ts     # POST /api/products/:id/marketplace-listings
├── hooks/useMarketplaceAccounts.ts             # TanStack Query — usado no seletor de conta (produto) e na tela admin
├── pages/admin/MarketplaceAccountsPage.tsx      # CRUD admin, mesmo padrão de CategoriesPage
└── features/products/PublishToMarketplace.tsx   # botão "Publicar no [Marketplace]" + seletor de conta (produto), spec seção 4.3
```

## 4. Fluxo de execução (camadas)

### 4.1 Cadastro de conta (admin)

```
MarketplaceAccountsPage
  → marketplace-account.service.ts (POST/PATCH /api/marketplace-accounts)
  → routes/marketplace-account.routes.ts (authenticate + authorize(["admin"]) + rate limit)
  → services/marketplace-account.service.ts
      → services/credential-encryption.service.ts (encrypt antes de persistir)
      → repositories/marketplace-account.repository.ts
  → audit_logs (MARKETPLACE_ACCOUNT_CREATE / _UPDATE / _DISABLE / _VIEW), ver 008
  → resposta nunca inclui `credential` em texto completo (`credentialPreview` mascarado, spec seção 2.2)
```

### 4.2 Publicação de produto

```
PublishToMarketplace (tela do produto)
  → marketplace-listing.service.ts (POST /api/products/:id/marketplace-listings)
  → routes/marketplace-listing.routes.ts (authenticate + authorize(["admin","operator"]))
  → services/marketplace-listing.service.ts
      → valida dados mínimos do produto (nome, categoria, preço de venda, ≥1 foto — spec 4.6)
      → repositories/marketplace-account.repository.findById (conta existe e está ativa?)
      → services/credential-encryption.service.ts (decrypt só em memória, nunca logado — spec seção 3)
      → plugins/marketplaces/marketplace-connector.port.ts → adapter concreto do marketplace
        (fora de escopo desta spec — 012+)
      → grava/atualiza a entrada correspondente em products.marketplaces
        (upsert por chave marketplace+conta_id, nunca duplica — spec seção 4.2)
  → audit_logs (PRODUCT_PUBLISH, já existe em 008), ver 008
```

## 5. Passos de implementação

1. `shared/schemas/marketplace.schema.ts`: `MarketplaceEnum`, `MarketplaceListingSchema`
   (`marketplace`, `conta_id`, `conta_apelido`, `status`, `id_anuncio`, `url_anuncio`,
   `publicado_em`, `erro`). `product.schema.ts` (005) passa a importar esse schema para
   `marketplaces: z.array(MarketplaceListingSchema).default([])` — **substitui** o
   `MarketplacesSchema` fixo atual (`{mercado_livre:{...}, shopee:{...}}`); ver riscos
   (seção 7) sobre migração de dados existentes.
2. `plugins/marketplaces/marketplace-connector.port.ts`: contrato mínimo
   `publish(product: Product, account: MarketplaceAccount): Promise<{ id_anuncio: string; url_anuncio: string }>`
   — mesma superfície mínima já aplicada ao adapter de IA (spec 006, seção 8.2, defesa E):
   sem function/tool calling, sem acesso a rede fora da chamada de publicação em si.
3. `services/credential-encryption.service.ts` (assíncrono): `encryptCredential(plain)` /
   `decryptCredential(ciphertext)`, AES-256-GCM via `node:crypto`
   (`createCipheriv`/`createDecipheriv`), IV aleatório por chamada, formato de armazenamento
   `{keyId}:{iv}:{authTag}:{ciphertext}` (partes de dados em base64). **Envelope encryption**
   (spec 011, seção 3.1; ADR-021): a chave de dados vem de `services/credential-key.service.ts`,
   que guarda as chaves versionadas (`k1`, `k2`, ...) na collection `credential_keys`
   (`repositories/credential-key.repository.ts`) **cifradas** pela chave-mestra
   `MARKETPLACE_CREDENTIAL_MASTER_KEY` (32 bytes, base64 — única chave fora do banco); a primeira
   é criada sozinha no primeiro uso; a ativa é a de maior versão; lida do banco a cada operação
   (sem cache). `services/credential-key-rotation.service.ts` cria a próxima versão e re-cifra as
   contas — exposto por `POST /api/marketplace-accounts/rotate-key` e `GET .../encryption-key`
   (admin), usados pelo botão da tela. Nunca loga `plain`, `ciphertext` nem material de chave.
4. `schemas/marketplace-account.schema.ts` + `repositories/marketplace-account.repository.ts`
   + `services/marketplace-account.service.ts`: mesma forma de 003 (categorias) — `list`,
   `create`, `updateProfile`, `updateStatus` — com a diferença de que `create`/`updateProfile`
   chamam `credential-encryption.service.encrypt` antes de persistir, e toda leitura
   (`list`/`findById`) passa por um mapeamento que substitui `credential` por
   `credentialPreview` (últimos 4 caracteres do valor original, calculados no momento do
   `encrypt` e guardados em um campo próprio — nunca derivados de uma decriptação sob
   demanda).
5. `routes/marketplace-account.routes.ts`: `GET`/`POST`/`PATCH /:id`/`PATCH /:id/status`, todas
   com `authorize(["admin"])` (diferente de 003, onde `GET` é liberado a qualquer perfil — aqui
   até o `GET` é admin-only, spec seção 2.2) + `config: { rateLimit: {...} }` por rota
   sensível (mesmo padrão de `auth.routes.ts`, 001).
6. `services/marketplace-listing.service.ts` + `routes/marketplace-listing.routes.ts`:
   `POST /products/:id/marketplace-listings`, `authorize(["admin","operator"])`.
7. Frontend: `MarketplaceAccountsPage` (CRUD admin, reaproveitando os mesmos padrões de
   formulário/tabela de `CategoriesPage`) e `PublishToMarketplace` (seletor de marketplace +
   conta, integrado à tela de edição de produto — spec seção 4.3, pulando a escolha de conta
   quando só há uma ativa).
8. Auditoria: registrar os quatro eventos novos de conta
   (`MARKETPLACE_ACCOUNT_CREATE/UPDATE/DISABLE/VIEW`) — `PRODUCT_PUBLISH` já existe em 008 e é
   reaproveitado sem alteração.

## 6. Testes planejados

- **Unitário**: `credential-encryption.service` — round-trip `encrypt`→`decrypt` recupera o
  valor original; ciphertexts do mesmo texto de entrada são diferentes entre chamadas (IV
  aleatório); `decrypt` de um valor adulterado falha (autenticação do GCM). `marketplace-account.service`
  rejeita `marketplace` fora do enum. `marketplace-listing.service` bloqueia publicação sem
  dados mínimos do produto (spec 4.6), sem chamar o conector; upsert nunca cria uma segunda
  entrada para a mesma combinação (marketplace, conta_id).
- **Integração**: `operator`/`viewer` recebem `403` em qualquer rota de
  `/api/marketplace-accounts` (inclusive `GET`); resposta de `GET`/`POST`/`PATCH` nunca contém
  o valor completo de `credential` em nenhum perfil; `POST /products/:id/marketplace-listings`
  bem-sucedido grava a entrada em `marketplaces`; publicar a mesma peça numa segunda conta do
  mesmo marketplace cria uma segunda entrada independente; desativar uma conta
  (`PATCH .../status`) não altera nem remove publicações já existentes feitas através dela.
- **E2E**: fora de escopo nesta spec — sem um adapter concreto real (spec 011 só define a
  porta), não há marketplace de verdade para publicar; planejado junto da spec do primeiro
  conector real (012, Mercado Livre), reaproveitando esta camada de contas/publicação.

## 7. Riscos / decisões em aberto

- **Migração do campo `products.marketplaces`**: hoje (`shared/schemas/product.schema.ts`)
  esse campo já existe como objeto fixo `{mercado_livre:{publicado,id_anuncio}, shopee:{...}}`
  (criado em 005, nunca usado de fato — constituição, seção 4, marca essa integração como
  fora do MVP). Migrar para o novo formato de lista (seção 5, passo 1) é uma mudança de shape
  do schema; antes de habilitar em produção, confirmar quantos documentos reais em
  `products` já têm esse campo preenchido com algo diferente do default (`{}` por marketplace)
  e, se houver algum, escrever um script de migração de dados — mesmo espírito de
  `scripts/seed-admin.ts` (ADR-004), não parte do runtime da aplicação.
- **Biblioteca de criptografia**: `node:crypto` nativo é a escolha default desta fase
  (seção 1); reavaliar apenas se surgir necessidade concreta de gestão de chaves mais robusta
  (rotação automática, HSM/KMS gerenciado) — não antecipado agora.
- **Formato de `credential`**: esta spec assume um único campo de texto opaco por conta
  (seção 5, passo 3), suficiente para credenciais de API key simples. Marketplaces cujo método
  de autenticação exija múltiplos segredos correlacionados (ex.: `client_id` +
  `client_secret` + `refresh_token` do OAuth) podem precisar que `credential` guarde um JSON
  serializado (ainda criptografado como um único blob) — decisão concreta cabe à spec do
  primeiro conector real (012) que o exigir.
- Nome definitivo de `MarketplaceConnectorPort` e da operação de publicação (`publish(...)`)
  pode mudar na implementação, desde que preserve a superfície mínima descrita na seção 5,
  passo 2.
