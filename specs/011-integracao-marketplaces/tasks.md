# Tasks 011 — Integração com Marketplaces (Camada de Conectores)

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Depende de:** [001-autenticacao/tasks.md](../001-autenticacao/tasks.md),
[002-usuarios/tasks.md](../002-usuarios/tasks.md) (`authorize.middleware.ts`),
[005-produtos-cadastro-manual/tasks.md](../005-produtos-cadastro-manual/tasks.md)
(`product.schema.ts`, `ProductForm.tsx`), [008-auditoria/tasks.md](../008-auditoria/tasks.md)
**Convenção:** `[P]` = tarefa paralelizável.

Nenhum adapter concreto de marketplace (Mercado Livre, Shopee, eBay) é implementado aqui — só
a porta comum, o cadastro de contas e a orquestração de publicação (spec, seção 1; plan,
seção 2). O primeiro conector real vira a spec 012.

## Fase 1 — Contrato e schemas (compartilhado)

- [x] T001 [P] `shared/schemas/marketplace.schema.ts`: `MarketplaceEnum`
      (`"mercado_livre" | "shopee" | "ebay"`), `MarketplaceListingSchema` (`marketplace`,
      `conta_id`, `conta_apelido`, `status`, `id_anuncio`, `url_anuncio`, `publicado_em`,
      `erro` — spec, seção 4.2).
- [x] T002 `shared/schemas/product.schema.ts`: substituiu `MarketplacesSchema` (objeto fixo
      `{mercado_livre:{...}, shopee:{...}}`) por uma lista de `MarketplaceListingSchema` —
      depende de T001. **Desvio real, descoberto validando num navegador contra o cluster de
      teste real**: um simples `z.array(...).default([])` só cobre a chave *ausente* — produtos
      já persistidos (mesmo no MVP, nunca usados de fato) têm `marketplaces` no formato antigo
      (objeto), e revalidar via `ProductSchema.parse()` (rotas de listagem/detalhe) quebrava com
      "Expected array, received object". Corrigido com
      `z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(MarketplaceListingSchema).default([]))`
      — seguro porque o campo nunca teve dado real antes desta spec. Teste de regressão
      dedicado em `product.schema.test.ts`. Script de migração de dados **não** foi necessário
      (nenhum documento tinha dado além do default).
- [x] T003 [P] `backend/src/plugins/marketplaces/marketplace-connector.port.ts`: interface
      `publish(product, account, credential): Promise<{ id_anuncio, url_anuncio }>` — **desvio
      do plano**: `credential` (já decriptada) entra como terceiro parâmetro explícito, em vez
      de embutida em `account`, pra deixar visualmente óbvio no contrato que só essa chamada
      tem acesso ao segredo em texto puro. Sem function/tool calling (mesmo espírito de
      superfície mínima do adapter de IA, spec 006).
- [x] T004 [P] `backend/src/services/credential-encryption.service.ts`
      (`encryptCredential`/`decryptCredential`, AES-256-GCM via `node:crypto`, IV aleatório por
      chamada, formato `{iv}:{authTag}:{ciphertext}` em base64, chave de
      `MARKETPLACE_CREDENTIAL_MASTER_KEY`, ver Fase 6) + `maskCredential` (últimos 4 caracteres).
- [x] T005 Teste unitário `credential-encryption.service.test.ts`: round-trip recupera o valor
      original; dois ciphertexts do mesmo texto são diferentes (IV aleatório); `decrypt` de
      valor adulterado ou malformado lança erro — depende de T004.
- [x] T006 [P] `backend/src/schemas/marketplace-account.schema.ts`:
      `MarketplaceAccountSchema` (resposta — `credentialPreview` mascarado, nunca `credential`
      completo), `Create`/`UpdateMarketplaceAccountSchema` (entrada, `credential` em texto
      puro), `UpdateMarketplaceAccountStatusSchema`, `ConnectionStatusEnum`.
- [x] T007 `backend/src/schemas/audit-log.schema.ts`: adicionados `MARKETPLACE_ACCOUNT_CREATE`,
      `MARKETPLACE_ACCOUNT_UPDATE`, `MARKETPLACE_ACCOUNT_DISABLE`, `MARKETPLACE_ACCOUNT_VIEW`
      ao `AuditActionEnum` (enum fechado — spec 008, seção 3).

## Fase 2 — Cadastro de contas de marketplace (backend)

- [x] T008 `backend/src/repositories/marketplace-account.repository.ts` (`findById`, `list`,
      `create`, `updateProfile`, `updateStatus`, + `updateConnectionStatus` não previsto
      originalmente, reservado para quando um conector real atualizar o status da conexão) —
      mesma forma de `category.repository.ts` (003).
- [x] T009 `backend/src/services/marketplace-account.service.ts`: `createMarketplaceAccount`,
      `listMarketplaceAccounts`, `getMarketplaceAccountById`, `updateMarketplaceAccountProfile`,
      `updateMarketplaceAccountStatus` — todas mascaram `credential` e auditam. **Adição não
      prevista no plano**: `getActiveMarketplaceAccountForConnector` (uso interno, nunca
      exposta via rota) — decripta a credencial em memória para `marketplace-listing.service`
      (T014), deliberadamente **sem** gerar `MARKETPLACE_ACCOUNT_VIEW` (esse evento cobre
      visualização/gestão administrativa, não o uso interno pelo conector durante a
      publicação, que já gera seu próprio `PRODUCT_PUBLISH`) — depende de T004, T006, T007,
      T008.
- [x] T010 Teste unitário `marketplace-account.service.test.ts` (8 casos) — depende de T009.
- [x] T011 `backend/src/routes/marketplace-account.routes.ts`: `GET /`, `GET /:id`, `POST /`,
      `PATCH /:id`, `PATCH /:id/status` — todas admin-only + rate limit (30/min) — depende de
      T009.
- [x] T012 `backend/src/modules/marketplace.module.ts`, registrado em `app.ts` — depende de
      T011.
- [x] T013 Teste de integração `marketplace-accounts.spec.ts` (10 casos, inclusive
      "permite mais de uma conta do mesmo marketplace") — depende de T012.

## Fase 3 — Publicação de produto no marketplace (backend)

- [x] T014 `backend/src/services/marketplace-listing.service.ts`: `publishListing(...)` —
      valida dados mínimos (`ProductMissingRequiredFieldsError`), valida conta ativa e
      pertencente ao marketplace escolhido (`MarketplaceAccountMismatchError`, não previsto
      originalmente — necessário pra impedir publicar com `marketplace` e `accountId`
      inconsistentes vindos do cliente), chama a porta via seam de teste
      `setMarketplaceConnectorForTesting` (mesmo padrão de `setImageProviderForTesting`/
      `setAiProviderForTesting`, 006/007 — sem adapter real registrado por padrão, lança erro
      claro se chamado sem injeção), grava resultado via
      `productRepository.upsertMarketplaceListing` (novo método no repository de produtos, não
      listado originalmente em `Estrutura de arquivos` do plan.md) — depende de T002, T003,
      T004, T008.
- [x] T015 Teste unitário `marketplace-listing.service.test.ts` (5 casos) — depende de T014.
- [x] T016 `backend/src/routes/marketplace-listing.routes.ts`:
      `POST /:id/marketplace-listings`, `authorize(["admin","operator"])` — depende de T014.
- [x] T017 Registrado em `marketplace.module.ts` sob `/api/products` (convivendo com
      `product.module.ts` no mesmo prefixo, sem conflito de rota) — depende de T012, T016.
- [x] T018 Teste de integração `marketplace-listings.spec.ts` (8 casos, com um dublê de
      conector configurável por credencial-sentinela para simular falha) — depende de T013,
      T017.

## Fase 4 — Frontend: contas de marketplace (admin)

- [x] T019 [P] `frontend/src/schemas/marketplace-account.schema.ts`. **Revisão pós-spec 012**:
      `credential` deixou de ser um único campo genérico no formulário — `MARKETPLACE_CREDENTIAL_FIELDS`
      define, por marketplace, quais campos aparecem (Mercado Livre: só Client ID + Client Secret —
      os tokens vêm do OAuth, spec 012, seções 2.1/2.2; demais marketplaces sem spec própria ainda:
      campo genérico único). `buildCredentialPayload` monta o valor único enviado à API —
      nenhuma mudança de schema no backend (spec 011, seção 2.2.1, nova). Mercado Livre também
      ganhou o teste de integração pré-cadastro (spec 012, seção 2.4): `IntegrationTestResultSchema`,
      `testMercadoLivreIntegration` no service, mutation `testIntegration` no hook e botão
      "Testar integração" que libera "Criar e conectar ao Mercado Livre".
- [x] T020 `frontend/src/services/marketplace-account.service.ts` — depende de T019. Atualizado
      para montar `credential` via `buildCredentialPayload` antes de enviar.
- [x] T021 `frontend/src/hooks/useMarketplaceAccounts.ts` — depende de T020.
- [x] T022 `frontend/src/pages/admin/MarketplaceAccountsPage.tsx` — depende de T021. Formulário
      de criação/edição renderiza um campo por informação da credencial, dinamicamente
      conforme o marketplace escolhido (spec 011, seção 2.2.1) — substitui o campo único
      "Credencial" original.
- [x] T023 Rota `/admin/marketplace-accounts` em `App.tsx` + item "Marketplaces" no menu
      (`AppLayout.tsx`) — depende de T022.

## Fase 5 — Frontend: publicação no produto

- [x] T024 [P] `frontend/src/services/marketplace-listing.service.ts`.
- [x] T025 `frontend/src/features/products/PublishToMarketplace.tsx` — depende de T021, T024.
      **Adição não prevista**: `frontend/src/hooks/useMarketplaceListings.ts`
      (`usePublishListing`, invalida o cache de produtos ao publicar) — plumbing necessária
      não detalhada no plan.md. **Desvio de implementação**: a escolha de conta pulada
      automaticamente (spec seção 4.3) é derivada durante a renderização (`accounts?.length
      === 1 ? accounts[0].id : selectedAccountId`), não via `useEffect` + `setState` — o lint
      do projeto (`react-hooks/set-state-in-effect`) rejeita esse padrão por causar renders em
      cascata; a troca de marketplace reseta a seleção manual direto no handler do `<select>`.
- [x] T026 Integrado em `ProductFormPage.tsx` (`EditProductSection`, antes do `ProductForm`) —
      depende de T025.

## Fase 6 — Chave de criptografia rotacionável pelo admin (spec 011, seção 3.1; ADR-021)

Primeira versão (ADR-020: keyring em variável de ambiente + script `rotate:credential-key`) foi
**substituída** antes de ser usada — o pedido passou a ser rotacionar por um botão na tela, o que
uma chave em variável de ambiente não permite. Sem suporte a nenhum formato anterior (nenhuma
conta real existia cifrada).

- [x] T027 `repositories/credential-key.repository.ts` (collection `credential_keys`: `_id = k{versão}`,
      `wrappedKey`, `createdAt`, `createdBy`) e `services/credential-key.service.ts` (envelope:
      chave-mestra `MARKETPLACE_CREDENTIAL_MASTER_KEY` embrulha as chaves de dados com o id como
      AAD; primeira chave criada sozinha; ativa = maior versão; `createNextCredentialKey` com
      conflito se duas rotações criarem a mesma versão) — depende de T004.
- [x] T028 `credential-encryption.service.ts` reescrito assíncrono sobre T027 (formato
      `{keyId}:{iv}:{authTag}:{dados}`, chave lida do banco a cada operação); chamadores em
      `marketplace-account.service.ts` passam a usar `await`. Testes: round-trip, primeira chave
      automática, adulteração/malformado/chave inexistente, chave-mestra errada ou ausente, chave
      embrulhada trocada de registro, rotação preserva valores antigos, conflito de rotações
      simultâneas — depende de T027.
- [x] T029 `marketplaceAccountRepository.replaceCredentialCiphertext` (atualização **condicional** ao
      ciphertext lido) e ação `MARKETPLACE_CREDENTIAL_KEY_ROTATE` no `AuditActionEnum` (spec 008) —
      depende de T008.
- [x] T030 `services/credential-key-rotation.service.ts` (`rotateCredentialKey(adminId)`,
      `getEncryptionKeyStatus`) + rotas `POST /api/marketplace-accounts/rotate-key` (admin, 5/min,
      409 em conflito) e `GET /api/marketplace-accounts/encryption-key` (admin, só metadados).
      Testes unitários (falha isolada por conta, edição concorrente, auditoria sem credenciais) e de
      integração via HTTP (RBAC, primeira chave automática, rotação sem perder credencial, chave de
      dados nunca em texto puro no banco, auditoria) — depende de T028, T029.
- [x] T031 Frontend: card "Chave de criptografia" em `MarketplaceAccountsPage.tsx` (chave ativa,
      contas por chave, botão **"Rotacionar chave de criptografia"** com confirmação, relatório
      k1 → k2 com falhas), `useEncryptionKeyStatus`/`useRotateEncryptionKey` e métodos no service —
      depende de T030.
- [x] T032 Configuração: `.env.example` documenta `MARKETPLACE_CREDENTIAL_MASTER_KEY`; testes de
      integração migrados para a nova variável — depende de T027.

## Fase 7 — Ciclo de vida da conta: Desconectar → Desativar → Apagar (spec 011, seção 2.2.2; ADR-022)

- [x] T033 Backend — `audit-log.schema.ts` (`MARKETPLACE_ACCOUNT_DISCONNECT`,
      `MARKETPLACE_ACCOUNT_DELETE`); repositório (`markDisconnected` — grava credencial sem tokens,
      `connectionStatus = disconnected` e remove `state` de OAuth pendente; `delete`).
- [x] T034 Backend — `marketplace-account.service.ts`: `disconnectMarketplaceAccount` (Mercado Livre
      descarta access/refresh token, `expires_at`, `user_id`); `updateMarketplaceAccountStatus`
      passa a exigir conta desconectada para desativar; `deleteMarketplaceAccount` exige
      desconectada **e** desativada; erro `MarketplaceAccountLifecycleError` (→ `409`) — depende de T033.
- [x] T035 Backend — rotas `POST /:id/disconnect` e `DELETE /:id` (admin, rate limit) — depende de T034.
- [x] T036 Testes: unitários do serviço (ordem imposta, tokens descartados, credencial não vazada
      na auditoria) e integração das rotas (fluxo completo, `409` fora de ordem, 403/401, anúncio
      publicado continua exibindo `conta_apelido`, `state` pendente cancelado pela desconexão) —
      depende de T035.
- [x] T037 Frontend — service/hook (`disconnect`, `remove`) e coluna "Ações" com o próximo passo
      válido e confirmação inline para Desconectar/Apagar — depende de T035.

## Verificação manual no navegador (fora do escopo original das tarefas, mas necessária)

Rodado contra o cluster de teste real (`e2e/`, mesma técnica de DNS SRV manual documentada em
`e2e/AGENTS.md`): login admin → cadastro de conta de marketplace (credencial nunca aparece em
texto completo na tela, só `****cdef`) → cadastro de produto com foto → tela de edição exibe a
seção "Marketplaces" com o seletor de conta e o botão "Publicar" → tentativa de publicar sem
foto mostra "Dados mínimos incompletos para publicar: ao menos uma foto" (validação do backend
chegando corretamente à UI). Foi essa verificação que encontrou e permitiu corrigir o desvio de
T002 (formato antigo de `marketplaces` quebrando a listagem de produtos).

**Não verificado manualmente nesta sessão**: o caminho completo até "Nenhum conector de
marketplace configurado" (que exige upload de foto real) — `AZURE_STORAGE_CONNECTION_STRING`
está vazio no `e2e/.env` deste ambiente, uma limitação do ambiente, não do código. Esse caminho
específico está coberto por teste automatizado (T015, T018).

## Dependências entre tarefas

```
T001 → T002
T004 → T005
T004 → T027 → T028 → T030 → T031
T008 → T029 → T030
T004, T006, T007, T008 → T009 → T010
T009 → T011 → T012
T002, T003, T004, T008 → T014 → T015
T014 → T016 → T017 (depende também de T012)
T012, T013, T017 → T018
T019 → T020 → T021 → T022 → T023
T021, T024 → T025 → T026
T033 → T034 → T035 → T036
T035 → T037
```

## Nota

Nome definitivo de `MarketplaceConnectorPort`/`publish(...)` (T003) e formato de `credential`
(T004/T006 — hoje um único texto opaco) podem mudar na implementação, desde que preservem a
superfície descrita no plan.md — decisões concretas cabem à spec do primeiro conector real
(012).
