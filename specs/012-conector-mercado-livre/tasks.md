# Tasks 012 — Conector Mercado Livre

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Depende de:** [011-integracao-marketplaces/tasks.md](../011-integracao-marketplaces/tasks.md)
(contas, porta, publicação, ciclo de vida da conta),
[005-produtos-cadastro-manual/tasks.md](../005-produtos-cadastro-manual/tasks.md),
[008-auditoria/tasks.md](../008-auditoria/tasks.md)
**Convenção:** `[P]` = tarefa paralelizável; `[x]` = concluída. Cada fase termina com `npm run
lint` e `npm run test` nos pacotes tocados (`backend/`, `frontend/`, `shared/`) — e, nas fases 7 e
8, `npm test` em `e2e/`. O frontend não tem testes unitários (convenção do projeto): o que ele faz é
coberto pelo E2E e pela verificação no navegador.

As fases seguem o [plan.md](plan.md) (seção 5), com uma fase A à frente para o que já foi entregue
antes de o plano existir (cadastro por OAuth, PKCE e teste de integração — spec, seções 2.2 e 2.4).

## Fase A — Já entregue: cadastro por OAuth, PKCE e teste de integração (spec, seções 2.1, 2.2, 2.4)

- [x] T001 Backend do cadastro por OAuth: `schemas/mercado-livre-credential.schema.ts` (credencial
      estruturada), `plugins/marketplaces/mercado-livre-oauth.client.ts` (`buildAuthorizationUrl`,
      `exchangeCode`), `services/mercado-livre-oauth.service.ts` (`startMercadoLivreAuthorization`,
      `completeMercadoLivreAuthorization`, `state` de uso único com 10 min), campos `oauthState*` no
      repositório, rotas `GET /oauth/redirect-uri`, `POST /:id/oauth/authorize` e
      `POST /oauth/mercado-livre/complete`. Testes: `mercado-livre-oauth.client.test.ts` e
      `tests/integration/mercado-livre-oauth.spec.ts`.
- [x] T002 PKCE (S256) sempre ligado — spec, seção 2.2: `code_verifier` gerado no "Conectar" e guardado
      com o `state` (`oauthCodeVerifier`), `code_challenge` na URL de autorização, verifier na troca do
      `code`; apagado no consumo do `state` e ao desconectar. Motivo: o aplicativo do Mercado Livre
      tem `use_pkce: true` e recusa a autorização sem `code_challenge` — depende de T001.
- [x] T003 Teste de integração no cadastro — spec, seção 2.4: `requestApplicationToken`
      (`client_credentials`) e `fetchCurrentUser` (`GET /users/me`) no cliente OAuth,
      `testMercadoLivreIntegration`, rota `POST /api/marketplace-accounts/mercado-livre/test-connection`
      (admin, 10/min) — depende de T001.
- [x] T004 Frontend do cadastro: campos Client ID/Client Secret, botão "Testar integração" que libera
      "Criar e conectar ao Mercado Livre", `OAuthCallbackPage` + rota
      `/admin/marketplace-accounts/oauth/callback`, botão Conectar/Reconectar na lista, redirect URI
      exibido a partir de `FRONTEND_URL` — depende de T001, T003.


- [x] T055 Usuário do Mercado Livre na conta (spec, seção 2.5): campo `expectedUser` (apelido ou ID) no cadastro e na edição;
      após o OAuth o backend confere `GET /users/me` com o esperado — divergência é `400` sem gravar tokens; a conta
      guarda `connectedUserId`/`connectedNickname` (limpos ao desconectar); editar o esperado desconecta a conta;
      coluna "Usuário" na lista de contas. Testes unitários do casamento (apelido, ID, `@`, maiúsculas) e de integração
      (confere, diverge, conta antiga sem esperado, editar desconecta) — depende de T001, T003, T004.
      **Feito** (21/09/2026): casamento em `mercado-livre-user-match.ts`; conferência em
      `completeMercadoLivreAuthorization` (`GET /users/me` após a troca do `code`); `expectedUser`,
      `connectedUserId` e `connectedNickname` na conta; `UnexpectedMercadoLivreUserError` → `400`; auditoria com
      `mlUserId`. A conta já conectada continua sem usuário esperado ("não informado") até ser editada.

## Fase 0 — Confirmações na documentação e no app (bloqueiam partes da Fase 4)

A documentação do Mercado Livre respondeu 403 para leitura automática; estas tarefas são de
confirmação **humana ou empírica**. Cada uma termina removendo o ⚠ correspondente da
[spec](spec.md) (e ajustando o plano, se o fato mudar algo).

- [x] T005 [P] Edição de anúncio com vendas (spec, seção 3.1) — confirmado em "Sincronização e
      modificação de publicações" (24/03/2026): com vendas não muda `title`/`buying_mode`/meios de
      pagamento; `title` só com `sold_quantity = 0`; `PUT` só com `price` é rejeitado se há
      automatização de preços (com outros campos, o preço é ignorado com *warning*). O "formato do erro
      de campo recusado" deixou de ser necessário: a regra é aplicada antes de enviar.
- [x] T006 [P] SKU (spec, seções 3 e 3.1) — confirmado em "Busca de itens": `GET
      /users/{user_id}/items/search?sku=…` (campo `seller_custom_field`) e `?seller_sku=…` (atributo
      `SELLER_SKU`); resposta `{ paging, results: [ids] }`; multiget `GET /items?ids=…&attributes=…` (até 20
      ids). "Só ativos" vale para a busca pública, não para esta — o conector confere o `status`.
- [x] T007 [P] Encerrar (spec, seção 7) — confirmado: `PUT /items/{id}` com `{"status":"closed"}`;
      estado final (não reativa); encerrados são descartados pelo próprio Mercado Livre; excluir é um
      segundo `PUT` com `{"deleted":"true"}` (fora de escopo); não há erro documentado para "já
      encerrado" → idempotência por `GET /items/{id}`; `POST /items/{id}/relist` existe mas não serve
      (só `price`/`quantity`/`listing_type_id`).
- [x] T008 [P] Categoria e payload de criação (spec, seções 3, 3.3, 4 e 6) — confirmado em "Publicar
      produtos", "User Products", "Domínios e Categorias", "Categorização de produtos", "Atributos",
      "Descrição de produtos" e "Validações": `settings` de `GET /categories/{id}`
      (`max_title_length`, `minimum_price`, `maximum_price` — pode ser `null` —, `max_pictures_per_item`,
      `max_description_length`, `immediate_payment`, `listing_allowed`); tags dos atributos e
      `POST /categories/{id}/attributes/conditional` para o GTIN; **modelo *User Products*: `family_name`
      no lugar de `title`, sem `variations`**; `condition` descontinuado (usa `ITEM_CONDITION`); descrição
      por `POST` (criar) e `PUT ...?api_version=2` (substituir); formato de erro `{ message, error,
      status, cause: [...] }`.
- [x] T009 [P] `sandbox_mode: true` do app (visto nos metadados do app "OpenERP Sample") — confirmado em
      "Realização de testes": o Mercado Livre **não tem sandbox**; usa-se **usuário de teste** em
      produção. A página não explica o `sandbox_mode` do app; tratado como sem efeito, a confirmar no
      primeiro teste da Fase 8. A Fase 8 passou a usar usuário de teste (título e categoria prescritos).
- [x] T010 [P] Decisão de negócio (spec, seção 3.2): a dona do brechó escolhe o
      `MERCADO_LIVRE_LISTING_TYPE_ID` (custo × exposição). Já reunido: tipos do MLB, `gold_special` e
      `gold_pro` sem prazo, `free` restrito, `listing_prices` para comparar o custo por tipo e categoria
      (exige token). Não bloqueia código (o padrão é `gold_special`), mas bloqueia o primeiro anúncio
      real (T043).
      **Decidida** (ADR-026, 22/09/2026): **sem** variável de ambiente — o operador escolhe o tipo de
      anúncio a cada publicação, na mesma tela de revisão da categoria (T059), lista estática ordenada
      do mais barato (`free`, padrão) ao mais caro (`gold_pro`). Ordem por faixa conhecida, não por preço
      real (`listing_prices` exige token, não consultado) — a confirmar na Fase 8 (T043/T044).
- [x] T046 [P] **Dimensões do pacote** (spec, seção 3.4) — decidido (b): pacote padrão configurável em
      `MERCADO_LIVRE_PACKAGE_DEFAULTS` (JSON com `padrao`, `por_departamento` e `por_categoria`; `altura_cm`,
      `largura_cm`, `comprimento_cm` inteiros e `peso_g` opcional), resolvido por categoria > departamento >
      padrão; peso do produto (kg → g, arredondado para cima) com `peso_g` como reserva. Implementação em
      T052; valores reais em T051. (Dimensões por produto no cadastro ficam como evolução — spec 005.)
      **Superada (ADR-027, 22/09/2026):** a decisão "b" (env var + prioridade categoria/departamento/padrão)
      foi substituída por um único pacote padrão, editado numa tela de admin e gravado no banco — ver T052.
- [x] T047 [P] **Moda: `GENDER` e tabela de medidas** (spec, seção 3.5) — leitura concluída ("Primeiros passos",
      "Gerenciar tabela de medidas" e "Validação da tabela de medidas"): domínios com tabela via
      `active_domains`; item leva `GENDER`, `SIZE`, `SIZE_GRID_ID` e `SIZE_GRID_ROW_ID`; tabela encontrada por
      `POST /catalog/charts/search` (preferência `BRAND` > `STANDARD`), linha por `GET /catalog/charts/{id}`;
      criar tabelas `SPECIFIC` fica fora de escopo. A implementação está em T022, T023 e T025.
- [x] T048 [P] "Identificadores de produtos" lida — `EMPTY_GTIN_REASON` confirmado (`Artesanal` 17055158, `Kit`
      17055159, `No registrado` 17055160, `Otro` 17055161; `value_id` vindo de `GET /categories/{id}/
      attributes`); implementação em T023.
- [x] T050 [P] **Tamanhos do ERP × tabelas de medidas** (spec, seção 3.5) — medido em 21/09/2026 com a conta real
      conectada (só leituras): `active_domains` tem 59 domínios (quase todos os de roupa); `STANDARD` existe só para
      5 domínios de calçado e `BRAND` só para 9 de calçado; **nenhum domínio de roupa tem tabela pronta** (busca
      `STANDARD` devolve 0). No ERP de dev, 7 de 9 produtos não têm `tamanho_etiqueta`; as linhas de calçado usam
      `"34,0 BR"` e o ERP guarda `"32"`. Consequências e decisões em T053 e T054.
- [x] T053 [P] **Decisão — tabela de medidas de roupas** (spec, seção 3.5; ADR-024, 22/09/2026): **opção 2** —
      o ERP cria/estende tabelas `SPECIFIC` por API (`POST /catalog/charts`, `measure_type: CLOTHING_MEASURE`,
      domínios `TOPS`/`BOTTOMS`), alimentadas pelas medidas reais de cada peça (`medidas`, spec 005) — cada peça é
      única (constituição, princípio X), então a medida real já é o que a tabela precisa. Uma tabela por
      domínio+gênero; linha nova só quando a combinação tamanho+medidas não existir ainda
      (`POST /catalog/charts/{id}/rows`), nunca edita linha existente nem recria a tabela.
- [x] T056 [P] **Estender `medidas` para as medidas de roupa do Mercado Livre** (ADR-024; spec 005, `MedidasSchema`;
      spec 012, seção 3.5): `coxa` (`GARMENT_THIGH_WIDTH_FROM`) e `entrepasso` (`GARMENT_INSEAM_LENGTH_FROM`) — os
      já existentes `cintura`/`quadril`/`gancho`/`comprimento` já mapeiam para `GARMENT_WAIST_WIDTH_FROM`/
      `GARMENT_HIP_WIDTH_FROM`/`GARMENT_FRONT_RISE_FROM`/`GARMENT_LENGTH_FROM`. Muda
      `shared/schemas/product.schema.ts` (`MedidasSchema`), `shared/schemas/ai-intake.schema.ts`
      (`AiMedidasSchema`) e `frontend/src/features/products/ProductForm.tsx` (dois campos novos na seção de
      medidas) — mesmo padrão dos campos existentes (`nullableNumber().default(null)`, documento antigo sem os
      campos continua válido). Confirmado só para domínios de parte de baixo; partes de cima (camisas, blusas,
      jaquetas, vestidos) esperam a leitura de `technical_specs` na implementação (T023) — se pedirem medida que o
      ERP não captura (busto, ombro, manga), vira uma extensão nova de `MedidasSchema`, decidida então. Bloqueia
      T023 e T025 para os domínios cobertos por esta extensão.
      **Feito** (22/09/2026): campos novos em `MedidasSchema`/`AiMedidasSchema`, `ProductForm.tsx` e nos dois
      schemas de formulário do frontend (`product.schema.ts`, `ai-intake.schema.ts`); fixtures de teste
      atualizadas em todos os arquivos que montam um `medidas` completo. `npm run build` em `shared/` (20/20) e
      `tsc --noEmit` limpo em `backend/`/`frontend/`.
- [x] T054 [P] **Decisão — categoria do Mercado Livre por peça** (spec, seção 4; ADR-025, 22/09/2026):
      **revisão humana obrigatória em toda publicação** (criar, republicar, recriar) — o preditor só sugere
      (pré-seleciona), o operador confirma ou escolhe outra categoria numa lista curada de categorias-folha
      de Roupas/Calçados/Bolsas antes do `POST /items`. **Sem** mapeamento configurável categoria do ERP →
      categoria do Mercado Livre: rejeitado porque a revisão sempre presente já cobre o risco que o
      mapeamento cobriria, sem exigir manter 12 categorias em sincronia com a taxonomia do Mercado Livre. O
      T050 mostrou o preditor errando o domínio de peças comuns ("camisa masculina" →
      `MLB-RUGBY_JERSEYS`), e a ADR-024 tornou isso mais caro de errar (cria tabela `SPECIFIC` no domínio
      errado). Desdobra em T057 (levantar a lista curada), T058 (endpoint de sugestão) e T059 (tela de
      revisão) — ver Fase 4/6. Libera T023 e T025 (que deixam de chamar o preditor internamente: recebem
      `categoryId` já resolvido).
- [x] T057 [P] **Levantar a lista curada de categorias para a tela de revisão** (spec, seção 4; ADR-025) —
      medição contra a conta real conectada, mesmo método da T050: navegar `GET /sites/MLB/categories`
      até achar o nó "Calçados, Roupas e Bolsas", descer recursivamente (`GET /categories/{id}` →
      `children_categories`) até as **categorias-folha** (sem filhos — só essas aceitam `POST /items`),
      e congelar `{ categoryId, categoryName, domainId? }[]` num arquivo versionado no repositório (não
      `MERCADO_LIVRE_PACKAGE_DEFAULTS`/env var — é taxonomia do Mercado Livre, não configuração da dona
      do brechó). Bloqueia T058/T059 (a lista é o que preenche o `<select>` de revisão).
      **Feito** (22/09/2026): `GET /sites/MLB/categories` (listagem plana) devolveu `403
      PA_UNAUTHORIZED_RESULT_FROM_POLICIES` — sem token, bloqueado por política antibot, não por falta de
      permissão; contornado sem precisar de conta conectada: `GET /categories/{id}` (id individual, que
      também devolve `children_categories`) funciona normalmente e sem token, e uma folha conhecida
      (Camisas, `MLB107292`) trouxe `path_from_root` confirmando a raiz `MLB1430` = "Calçados, Roupas e
      Bolsas". Script `backend/src/scripts/fetch-mercado-livre-category-catalog.ts`
      (`npm run fetch:mercado-livre-categories`), 5 chamadas simultâneas no máximo — desceu a árvore
      inteira (233 categorias visitadas) e gravou 207 categorias-folha, todas com `categoryId` único, em
      `backend/src/plugins/marketplaces/mercado-livre-category-catalog.json`.
- [ ] T051 [P] **Valores reais do pacote padrão** (spec, seção 3.4; ADR-027) — a dona do brechó preenche a
      tela "Contas de marketplace → Pacote padrão do Mercado Livre" com altura, largura, comprimento (cm)
      e peso (g) — um valor só, que serve para toda peça (sem exceção por categoria/departamento,
      ADR-027). Bloqueia a primeira publicação real (T049), não o código — a tela e a gravação no banco já
      estão prontas (T052).

## Fase 1 — Contrato compartilhado, auditoria e contagem

- [x] T011 `shared/schemas/marketplace.schema.ts`: `encerrado` em `MarketplaceListingStatusEnum` e
      `encerrado_em` (`z.coerce.date().nullable().default(null)` — documentos antigos não têm o
      campo); `npm run build` em `shared/` (backend e frontend importam `shared/dist`). Testes em
      `shared/schemas/` para o campo novo e para documento antigo sem `encerrado_em`.
- [x] T012 [P] Auditoria: `PRODUCT_UNPUBLISH` no `AuditActionEnum` do backend **e** no do frontend
      (`frontend/src/schemas/audit-log.schema.ts`, cópia própria), com o rótulo "Anúncio encerrado" em
      `AuditLogsPage.tsx`; registrar a ação na lista da spec 008. Teste de contrato no backend
      (`tests/`) que lê `frontend/src/schemas/audit-log.schema.ts` como texto, extrai os literais do
      enum e falha se os dois lados diferirem — a omissão dessa cópia já quebrou a tela de Auditoria
      (ações `MARKETPLACE_*`).
- [x] T013 [P] `productRepository.countPublishedListingsByAccount(db)`: `aggregate` com `$unwind` de
      `marketplaces`, `$match` em `status = "publicado"`, `$group` por `conta_id` → `Map<string, number>`.
      Conta todos os produtos, inclusive `vendido`/`inativo`. Teste com MongoDB em memória.
- [x] T014 `publishedListingsCount` (inteiro) no schema de resposta de conta — backend e frontend — e um
      helper único em `marketplace-account.service.ts` que o preenche em **todas** as respostas de conta
      (listar, obter, criar, editar, ativar/desativar, desconectar, conectar); atualizar os testes de
      conta existentes — depende de T013. **Feito** com `presentMarketplaceAccount`/`presentMarketplaceAccounts` em
      `marketplace-account.service.ts` (um só `aggregate` por chamada) e o teste de integração
      `tests/integration/marketplace-published-count.spec.ts`. Como efeito colateral, o tipo da porta passou a usar
      `ConnectorAccount` (conta sem a contagem) até T015 redefinir a porta.

## Fase 2 — Porta, registro de conectores e migração dos dublês

- [x] T015 `plugins/marketplaces/marketplace-connector.port.ts`: `publish({ product, listing, account,
      credential })` e `close({ listing, account, credential })`, ambos → `ConnectorOutcome<T> = { value;
      updatedCredential? }`; `PublishResult = { id_anuncio, url_anuncio, pendencia: string | null }`;
      `MarketplaceConnectorError { updatedCredential?, reconnectRequired }` — depende de T011.
- [x] T016 `plugins/marketplaces/connector-registry.ts`: `getConnector(marketplace)`; o override de teste
      (`setMarketplaceConnectorForTesting`, mantido) vale para qualquer marketplace; sem override usa o
      registro; marketplace sem conector → erro "Nenhum conector configurado para X" (comportamento
      atual) — depende de T015.
- [x] T017 Adaptar `publishListing` ao contrato novo **sem mudar comportamento** e migrar os dublês de
      `marketplace-listing.service.test.ts` e `tests/integration/marketplace-listings.spec.ts`: todos os
      testes existentes de 011 continuam passando com as mesmas afirmações — depende de T016.
      **Feito** (21/09/2026): `publishListing` passa `{ product, listing, account, credential }` ao conector (a conta sem a
      credencial cifrada) e grava `erro = pendencia`; o seam `setMarketplaceConnectorForTesting` segue exportado do
      serviço; testes novos do registro e do contrato da porta.

## Fase 3 — Trava por conta e persistência de credencial

- [x] T018 `marketplace-account.repository.ts`: `acquireOperationLease(db, id, owner, ttlMs)`
      (`findOneAndUpdate` condicionado a "sem trava ou trava vencida", campos internos
      `operationLeaseOwner`/`operationLeaseExpiresAt`, nunca expostos) e `releaseOperationLease(db, id,
      owner)` (só libera se o dono for o mesmo). Testes com MongoDB em memória: dois donos disputando,
      trava vencida retomada, liberação por dono errado ignorada.
- [x] T019 `services/account-operation.service.ts` — `runAccountOperation(accountId, op)`: espera a trava
      (poll de 250 ms, até 15 s, senão `AccountBusyError`), validade da trava 120 s; relê a conta e
      decifra a credencial; roda `op`; no `finally` persiste `updatedCredential` (condicional ao
      ciphertext lido, via `replaceCredentialCiphertext` — no sucesso **e** no erro), aplica
      `reconnectRequired → connectionStatus = expired` e solta a trava; nunca loga credencial. Testes:
      duas operações na mesma conta rodam em série; ocupada além de 15 s → `AccountBusyError`; par novo
      descartado se a conta foi desconectada durante a operação; `expired` só com `reconnectRequired` —
      depende de T015, T018.
      **Feito** (21/09/2026): `account-operation.service.ts` (`runAccountOperation`, `tryAcquireAccountLease`,
      `AccountBusyError`); repositório com `acquireOperationLease`/`releaseOperationLease` e `markExpiredIfUnchanged`
      (só marca `expired` se a conta não mudou nem foi desconectada); `tests/integration/account-operation.spec.ts`
      (19 casos).
- [x] T020 `credential-key-rotation.service.ts`: tenta a trava por conta e **pula** a ocupada (conta em
      `skippedConcurrent`); atualizar `credential-key-rotation.service.test.ts` e
      `tests/integration/credential-key-rotation.spec.ts` — depende de T018.

## Fase 4 — Adaptador do Mercado Livre

- [x] T021 `mercado-livre-oauth.client.ts`: `refreshToken({ clientId, clientSecret, refreshToken })`
      (`grant_type=refresh_token`); `invalid_grant` → erro com `reconnectRequired`, erro de rede/5xx sem
      o flag; incluir o método na interface `MercadoLivreOAuthClient` e atualizar os fakes de teste
      (`mercado-livre-oauth.spec.ts`, `marketplace-account-lifecycle.spec.ts`). Testes em
      `mercado-livre-oauth.client.test.ts` (corpo enviado, `invalid_grant`, erro de rede, mensagem sem
      segredo) — depende de T001.
      **Feito** (22/09/2026): `MercadoLivreInvalidGrantError` e `refreshToken` em `mercado-livre-oauth.client.ts`;
      5 testes novos. **Não** atualizados os fakes de `tests/integration/mercado-livre-oauth.spec.ts` e
      `marketplace-account-lifecycle.spec.ts` — não implementam o método novo, mas nada ali o exercita; como
      `backend/tsconfig.json` só inclui `src` no `tsc`, isso não aparece nem no type-check nem no vitest
      (gap pré-existente, fora do escopo desta tarefa).
- [x] T022 [P] `plugins/marketplaces/mercado-livre-api.client.ts`: uma função por chamada — `GET /users/me`
      (tag `user_product_seller`), predictor de categoria, `GET /categories/{id}`,
      `GET /categories/{id}/attributes`, `POST /categories/{id}/attributes/conditional`,
      `GET /categories/{id}/sale_terms`, `POST`/`PUT /items`, `GET /items/{id}`, multiget
      `GET /items?ids=…&attributes=…` (até 20 ids), `POST`/`PUT /items/{id}/description[?api_version=2]`,
      busca por SKU `GET /users/{user_id}/items/search?seller_sku=…&orders=start_time_desc`,
      `PUT /items/{id}` com `status: closed` e, para moda, `GET /catalog/charts/MLB/configurations/active_domains`,
      `GET /domains/{id}/technical_specs?section=grids`, `POST /catalog/charts/search`, `GET /catalog/charts/{id}`,
      `POST /catalog/charts` (criar tabela `SPECIFIC`) e `POST /catalog/charts/{id}/rows` (adicionar linha) — todas
      com `Authorization: Bearer`, timeout de 15 s, resposta validada por Zod, erro classificado
      (`MercadoLivreApiError { status, code, causes }`, lendo `cause[]` no formato da spec 3.6), mensagens
      sem token nem `client_secret`; base URL de `MERCADO_LIVRE_API_BASE_URL` (aceita só fora de
      `NODE_ENV=production`). 429/5xx sem repetição; **única** repetição automática: `409` de versão no
      encerramento (espera e repete, até 3×). Testes com `fetch` simulado e relógio falso — depende de
      T005, T006, T007, T008 (todas confirmadas).
      **Feito** (22/09/2026): todas as funções listadas implementadas (incluindo o conjunto de tabelas de
      medidas); 34 testes em `mercado-livre-api.client.test.ts`. `MERCADO_LIVRE_API_BASE_URL` documentada em
      `backend/.env.example`.
      **Corrigido no T043 (22/09/2026, testes reais):** `getDomainSizeChartAttributes` tinha um nível de
      `components` a menos que a estrutura real (`groups[].components[].components[].attributes[]`, dois
      níveis aninhados) — nunca encontrava nada antes da correção. `MercadoLivreApiError`: `cause` às vezes
      não é array (quebrava com `.map is not a function` — agora com `Array.isArray()`); formato alternativo
      `errors` (sem `type`, visto em `/catalog/charts`) passou a ser lido também, sempre como bloqueante. 39
      testes em `mercado-livre-api.client.test.ts` (+5).
- [x] T023 [P] `plugins/marketplaces/mercado-livre-item.mapper.ts` — recebe `categoryId` já resolvido pela
      revisão (spec 012, seção 4; ADR-025) — **não** chama o preditor. Funções **puras**: `buildCreatePayload`
      (`family_name` × `title` conforme o modelo do vendedor), `buildUpdatePayload`, `mapCondition`
      (`novo → "Novo"`; `seminovo`/`usado → "Usado"`, `value_id` dos atributos da categoria, atributo
      `ITEM_CONDITION` — nunca `condition`), `pickAttributes` (só o que a categoria aceita; nunca
      `read_only`/`fixed`/`inferred`), `skuAttribute` (`SELLER_SKU`), `packageAttributes` (inteiros, cm e g; a partir de `resolvePackage`, T052), `gtinAttribute` (`EMPTY_GTIN_REASON` com o `value_id` da categoria,
      só quando exigido), `genderAttribute` (departamento → `GENDER`), `sizeChartAttributes` (`SIZE`,
      `SIZE_GRID_ID`, `SIZE_GRID_ROW_ID`), `garmentMeasureAttributes` (`medidas` → `GARMENT_*`, tabela da spec
      3.5 — ADR-024), `pickChartRow` — calçado: `SIZE` igual a `tamanho_etiqueta`, senão `tamanho_equivalente`,
      `BRAND` > `STANDARD`; roupa: `SIZE` + todos os `GARMENT_*` idênticos numa tabela `SPECIFIC` (achar ou
      indicar que precisa criar linha) —, `buildChartPayload` (corpo de `POST /catalog/charts` e de
      `.../rows`, nome ≤ 60 caracteres gerado pelo conector), `truncateName` (`max_title_length`),
      `capPictures` (`max_pictures_per_item`, capa primeiro), `sanitizePlainText` (só `\n`, sem
      HTML/emoji, `max_description_length`), `immediateTag`, `assertPriceInRange` (falha antes de qualquer
      `POST`/`PUT`), garantia (sem garantia; nunca "Recondicionado"), `available_quantity = 1`,
      `listing_type_id` recebido como parâmetro (nunca configurável por variável de ambiente — ADR-026).
      Testes em tabela — depende de T008, T052, T054, T056, T010.
      **Nota (22/09/2026):** T054 decidiu que `categoryId` chega como parâmetro (resolvido na revisão do
      operador, T058/T059) — o mapeador não chama mais o preditor, só usa o `categoryId` recebido. T010
      (ADR-026) decidiu o mesmo para `listingTypeId`: chega como parâmetro, escolhido pelo operador na
      mesma tela.
      **Feito** (22/09/2026): todas as funções puras listadas implementadas em
      `mercado-livre-item.mapper.ts`, mais `brandAttribute`/`colorAttribute` (melhor esforço, spec seção 3)
      e `isKnownGarmentMeasureAttribute` (distingue "medida em branco" de "atributo ainda não confirmado
      pela ADR-024" nos `missingAttributeIds` de `garmentMeasureAttributes`). `sanitizePlainText` só
      normaliza `\r\n`→`\n` e corta em `max_description_length` — decidiu **não** tentar filtrar HTML/emoji
      sozinho (arriscaria mudar um texto do operador sem necessidade; a validação real do Mercado Livre já
      aponta a posição do caractere problemático, spec seção 3.6). `garmentMeasureAttributes` usa o mesmo
      formato `"{n} {unidade}"` do pacote padrão — não documentado para `GARMENT_*` nas fontes salvas, a
      confirmar na Fase 8. 51 testes em `mercado-livre-item.mapper.test.ts`, todos verdes.
      `getCategory` (T022) ganhou `catalogDomain` (`settings.catalog_domain`) e `fetchCurrentUser` (cliente
      OAuth) ganhou `tags` (`user_product_seller`) — os dois confirmados contra a API real durante o T057 e
      necessários para o conector (T025/T026) saber o domínio da categoria e o modelo de publicação.
      **Ajustado no T043 (22/09/2026, testes reais):** `colorAttribute` virou `colorAttributes` (plural —
      envia `COLOR` e `MAIN_COLOR` juntos quando a categoria tem os dois, só um dos dois perdia o que era
      `required`); `modelAttribute` novo (reaproveita `identificacao.nome` para o atributo `MODEL`, texto
      livre exigido por várias categorias de acessórios — decisão do usuário); sinônimo
      `"unissexo" → "sem gênero"` em `genderAttribute` (departamento do ERP não bate textualmente com o
      valor do Mercado Livre); `buildChartName` parou de aceitar "—" (só letras/números/espaço — o Mercado
      Livre recusava mesmo dentro do limite de 60 caracteres); `buildChartRowPayload` ganhou
      `FILTRABLE_SIZE` (espelha `SIZE`, exigido e não documentado); `buildUpdatePayload` nunca mais inclui
      `family_name` (o Mercado Livre rejeita reenviá-lo, mesmo sem mudança — contradiz a suposição original
      da spec 012, seção 3.1). Todos com teste de regressão.
- [x] T024 `plugins/marketplaces/mercado-livre.connector.ts` — token: lê a credencial
      (`parseMercadoLivreCredential`); sem tokens → erro "conta não conectada" (`reconnectRequired`);
      `expires_at` a menos de 5 min → `refreshToken()` e devolve o par novo em `updatedCredential`; um
      `401` da API → renova e repete a chamada 1×; lê a tag `user_product_seller` de `GET /users/me`; todo
      erro sai como `MarketplaceConnectorError` **carregando o `updatedCredential`** se houve renovação
      antes da falha. Testes com API/OAuth falsos — depende de T015, T021, T022.
      **Feito** (22/09/2026): renovação proativa (margem 5 min) e reativa (401 → renova e repete 1×) prontas,
      com `updatedCredential` sempre presente quando houve renovação antes de uma falha; 15 testes em
      `mercado-livre.connector.test.ts`. A leitura da tag `user_product_seller` de `GET /users/me` fica para
      T025 (não é necessária para `close`). `publish()` só lança "não implementado" (T054 em aberto) —
      `close()` está completo, ver T027.
      **T025/T026 fecharam (22/09/2026):** `publish()` delega para `mercado-livre-publish.ts` — ver abaixo.
      `fetchCurrentUser` (cliente OAuth) ganhou `tags` (`user_product_seller`).
- [x] T025 Conector — **criar**: recebe `categoryId` já confirmado pelo operador (T058/T059; ADR-025 — o
      conector **não** chama mais o preditor) → `GET /categories/{id}` (exige
      `listing_allowed` e `status = enabled`) → atributos (+ endpoint condicional para o GTIN) → **moda:**
      se o domínio está em `active_domains` — **calçado:** procura tabela `BRAND`/`STANDARD` e a linha por
      `SIZE`, falha antes do `POST` se não houver; **roupa (ADR-024):** confere se `medidas` tem o que o
      domínio exige (senão falha antes do `POST`), procura a tabela `SPECIFIC` do domínio+gênero (cria se
      não existir) e a linha por `SIZE`+`GARMENT_*` (adiciona se não existir) — → valida faixa de preço →
      `POST /items` → `POST` da descrição; descrição que falha vira `pendencia` (o item não é desfeito);
      retentativa de entrada sem `id_anuncio` procura antes pelo SKU
      (`GET /users/{user_id}/items/search?seller_sku=…`), consulta os ids achados em multiget e adota o
      mais recente que **não** esteja `closed`. Testes: criação completa nos dois modelos (`family_name` e
      `title`), descrição falha, resposta perdida com adoção por SKU, preço fora da faixa (nenhuma chamada
      de escrita), categoria sem `listing_allowed`, calçado com tabela `BRAND`/`STANDARD`, roupa criando
      tabela `SPECIFIC` na primeira peça, roupa adicionando linha numa tabela `SPECIFIC` existente, roupa
      reaproveitando linha idêntica, roupa sem `medidas` mínimas, domínio fora de `active_domains` —
      depende de T023, T024.
      **Feito** (22/09/2026): `mercado-livre-publish.ts` (`createNewItem`/`buildAttributes`/
      `resolveGtinAttribute`/`resolveSizeChartAttributes`/`resolveFootwearChart`/`resolveClothingChart`).
      A categoria→domínio vem de `settings.catalog_domain` (`GET /categories/{id}`, confirmado contra a API
      real no T057 — `getCategory`, T022, ganhou o campo `catalogDomain`). Calçado × roupa decidido pela
      `categoria_codigo` do ERP (`SAPT` → calçado; as demais categorias de moda → `SPECIFIC`) — mais simples
      e confiável que tentar inferir pela taxonomia de domínios do Mercado Livre. Todos os cenários da lista
      acima cobertos, mais GTIN required/conditional_required e erro claro sem `EMPTY_GTIN_REASON`
      disponível — 42 testes em `mercado-livre-publish.test.ts`.
- [x] T060 [P] **Achar a origem real dos atributos `GARMENT_*` exigidos pela tabela `SPECIFIC`** (spec 012,
      seção 3.5; ADR-024, pendência do T043) — `GET /domains/{domain}/technical_specs` (com e sem
      `section=grids`) **não lista `GARMENT_*`** para `MLB-SHORTS` (confirmado ao vivo, parser corrigido);
      `GET /categories/{id}/attributes` também não. Mesmo assim, `POST /catalog/charts` recusa a linha sem
      `GARMENT_HIP_WIDTH_FROM` (`required_row_attribute_not_found`). Investigar: um chart `STANDARD`/`BRAND`
      existente de domínio parecido pode revelar o conjunto de atributos esperado
      (`GET /catalog/charts/{id}`, olhando os `rows[].attributes` de uma tabela já populada por outro
      vendedor); ou suporte do Mercado Livre. **Não iterar por tentativa e erro contra a API real** — só
      testar de novo com uma hipótese fundamentada. Bloqueia: publicar roupa com tabela de medidas
      (domínios em `active_domains`, fora de calçado) — calçado (`SAPT`) e moda sem tabela não são
      afetados. Depende de T025 (feita, com a lacuna documentada).
      **Confirmado também em domínio de parte de cima (23/09/2026, uso real):** publicar um casaco
      (`MLB-JACKETS_AND_COATS` ou equivalente) esbarrou em `"Required attribute GARMENT_CHEST_WIDTH_FROM
      was not found in row SIZE 48 - MEDIO"` — mesma causa raiz do T060 (technical_specs não lista o
      atributo, então o pré-checo do ERP não bloqueia antes da chamada real, e o erro cru do Mercado
      Livre vaza pro operador em vez da mensagem própria do ERP). Pior que o caso de calças/shorts:
      `busto` (`GARMENT_CHEST_WIDTH_FROM`) nem existe em `MedidasSchema` ainda, e a spec (seção 3.5) já
      previa que partes de cima podem pedir mais medidas não confirmadas (ombro, manga) — cada uma só
      aparece numa tentativa real depois de resolver a anterior. **Decisão do usuário (23/09/2026):** não
      investir agora — casacos/jaquetas (domínios de "parte de cima") ficam fora do Mercado Livre por
      enquanto, sem mudança de código nessa hora.
      **Causa raiz achada (23/09/2026, mesmo dia, documentação oficial do Mercado Livre — não tentativa e
      erro contra a API real):** `GET /domains/{domain}/technical_specs?section=grids` (sem corpo) sempre
      devolveu a ficha técnica **genérica** do domínio. Os atributos `GARMENT_*` têm
      `"hierarchy": "CHILD_DEPENDENT"` — dependem do `GENDER` escolhido (um casaco masculino e um feminino
      pedem medidas diferentes) — e só aparecem numa consulta **`POST`** (não `GET`) informando o `GENDER`
      já resolvido no corpo. Documentado em "Check the product specification sheet of the size chart"
      (developers.mercadolibre.com.ar/en_us/first-steps-mkt) — exemplo real: `POST
      /domains/MLA-SNEAKERS/technical_specs?section=grids` com `{"attributes": [{"id": "GENDER",
      "value_id": "339665", "value_name": "Mujer", ...}]}` no corpo. Bate com o formato de erro
      documentado `chart_tech_specs_not_found`: `"Chart technical specification not found for
      SITE:{SITE}-DOMAIN:{DOMAIN}-GENDER:{VALUE_NAME}"` — a ficha é indexada por site+domínio+**gênero**,
      nunca só por domínio.
      **Corrigido:** `getDomainSizeChartAttributes` (`mercado-livre-api.client.ts`) virou `POST` com o
      `GENDER` (já resolvido antes, mesmo ponto do fluxo que decide calçado × roupa) no corpo;
      `mercado-livre-publish.ts` passa `gender.value_id`/`gender.value_name`. Teste de regressão
      confirmando `POST` + `section=grids` na query + `GENDER` no corpo, e que a orquestração chama a
      função com o gênero resolvido. **Ainda não confirmado contra a API real** (sem token de acesso
      válido da conta conectada neste ambiente de execução) — a próxima publicação real de uma peça com
      tabela de medidas confirma se a ficha técnica agora traz os atributos `GARMENT_*` esperados.
      **Mudança de decisão do usuário (23/09/2026, mesmo dia):** "vamos investir agora no tratamento de
      medidas pois muitas peças estão ficando de fora" — revoga a decisão anterior de não mexer em
      partes de cima. `busto` (`GARMENT_CHEST_WIDTH_FROM`, o único confirmado ao vivo) virou campo de
      `MedidasSchema` (spec 005) — mesmo padrão de `coxa`/`entrepasso` (T056): `.default(null)` em
      `product.schema.ts` e em `AiMedidasSchema`, campo novo em `ProductForm.tsx`. `GARMENT_MEASURE_BY_ATTRIBUTE`
      (mapper) ganhou a entrada. Ombro e manga (spec 012, seção 3.5) continuam sem entrada — nenhum
      erro real ainda confirmou o id exato — mas a mensagem de "atributo não confirmado" agora inclui o
      **nome real** devolvido pelo Mercado Livre (`technical_specs`), não só o id: da próxima vez que
      aparecer um desses, dá pra mapear direto pela mensagem, sem precisar investigar a API de novo. A
      mensagem de "medida em branco" também passou a mostrar o nome do campo do ERP (ex. "cintura"), não
      o id do Mercado Livre (ex. `GARMENT_WAIST_WIDTH_FROM`) — o operador não reconhecia o id.
- [x] T026 Conector — **atualizar**: `GET /items/{id}` (status, `sold_quantity`, categoria) → categoria e
      atributos → `PUT /items/{id}` → descrição por `PUT ...?api_version=2` (queda para `POST` se o item
      ainda não tem descrição); `family_name`/título só se `sold_quantity = 0`; `pictures` sempre incluído;
      `warnings` da resposta (preço ignorado) viram `pendencia`; item já `closed` no Mercado Livre → erro que
      orienta usar "Encerrar anúncio". Testes correspondentes (nome com e sem vendas, *warning* de preço,
      descrição inexistente) — depende de T023, T024.
      **Feito** (22/09/2026): `updateExistingItem` em `mercado-livre-publish.ts`, mesmo arquivo/testes do
      T025 (a montagem de atributos é compartilhada entre criar e atualizar).
- [x] T027 Conector — **encerrar**: `GET /items/{id}` antes (`status = closed` → sucesso sem `PUT`); senão
      `PUT { status: "closed" }`; `409` repetido antes de falhar; item `under_review`/`payment_required`
      que recuse `closed` → mensagem do Mercado Livre ao operador. Testes — depende de T022, T024.
      **Feito** (22/09/2026): `close()` idempotente (`GET` antes) com `closeItem` já cobrindo a repetição de
      `409` (T022); mensagem do Mercado Livre repassada como veio, sem token/credencial.
- [x] T028 Configuração e registro: `MERCADO_LIVRE_API_BASE_URL` lida na criação do conector,
      documentada em `backend/.env.example`; registrar o conector em `connector-registry.ts` — depende
      de T016, T025, T026, T027. ~~`MERCADO_LIVRE_LISTING_TYPE_ID`~~ removida do escopo (ADR-026): tipo de
      anúncio não é mais variável de ambiente, é `listingTypeId` escolhido pelo operador (T010/T059).
      **Feito** (22/09/2026): `mercadoLivreConnector` registrado em `connector-registry.ts` (via
      `marketplace.module.ts`, no bootstrap); `MERCADO_LIVRE_API_BASE_URL` documentada em
      `backend/.env.example`. `publish()` agora tem efeito real (T025/T026 fecharam) — `create`/`update`/
      `close` funcionam de ponta a ponta.
- [ ] T058 Sugestão de categoria (spec 012, seção 4; spec 011, seção 4.5; ADR-025): serviço que chama
      `predictCategory` (T022) com o nome do produto — falha do preditor (rede, indisponibilidade) não
      lança, devolve sugestão `null`, a rota segue `200` com a lista curada mesmo assim (a revisão nunca
      trava por causa do preditor); junta a sugestão (se houver) com a lista curada (T057), marcando qual
      item é a sugestão. Rota `POST /api/products/:id/marketplace-category-suggestion`, corpo
      `{ marketplace, accountId }`, `role ∈ {admin, operator}`, mapeia conta inexistente/inativa → `404`.
      Testes unitários e de rota — depende de T022, T057.
      **Feito** (22/09/2026): `mercado-livre-category-catalog.ts` (loader do JSON do T057, leitura a cada
      chamada, `CategoryCatalogError` claro se ausente/vazio/inválido — 6 testes); `suggestCategory`
      exportado por `mercado-livre.connector.ts` **fora** da `MarketplaceConnectorPort` (reaproveita
      `callWithFreshToken`, mesma renovação de token de `publish`/`close` — 4 testes novos no conector);
      `marketplace-category-suggestion.service.ts` (junta sugestão + lista curada, nunca lança por falha
      do preditor — só `AccountBusyError`/conta inexistente propagam — 7 testes); rota nova em
      `marketplace-listing.routes.ts`. `tests/integration/marketplace-listings.spec.ts` (existente)
      continua verde. Sem teste de integração dedicado à rota nova (mesmo padrão do T031 — service com
      cobertura unitária completa, integração fica para o T032).


- [x] T052 Configuração do pacote padrão (spec, seção 3.4): `plugins/marketplaces/mercado-livre-package.config.ts`
      — schema Zod de `MERCADO_LIVRE_PACKAGE_DEFAULTS` (`padrao` obrigatório; entradas com `altura_cm`,
      `largura_cm`, `comprimento_cm` inteiros > 0 e `peso_g` opcional), leitura tardia (só quando o conector
      precisa), `resolvePackage(product)` com prioridade categoria > departamento > padrão e peso do produto
      (kg → g, `ceil`) com `peso_g` de reserva; erros claros (`PackageConfigError`) para variável ausente,
      JSON quebrado e peso inexistente, que o serviço grava como `erro` **antes** do `POST`; exemplo em
      `backend/.env.example`. Testes em tabela (as três prioridades, peso do produto × reserva, variável
      ausente, JSON inválido) — depende de T015.
      **Feito** (22/09/2026): `resolvePackage` com as três prioridades e a regra de arredondamento (`ceil`);
      11 testes em `mercado-livre-package.config.test.ts`; exemplo documentado em `backend/.env.example`.
      Ainda não tem consumidor (T023/T025 seguem não implementadas — T054 já decidida, ver ADR-025).
      **Refeito (ADR-027, 22/09/2026):** por pedido do usuário, o pacote padrão virou campos de formulário
      numa tela de admin, gravados no banco — não mais a variável de ambiente acima. Mudanças: schema
      compartilhado novo `shared/schemas/mercado-livre-package-settings.schema.ts`
      (`MercadoLivrePackageSettingsSchema`, os 4 campos sempre obrigatórios — `peso_g` deixa de ser
      opcional); `mercado-livre-package-settings.repository.ts` (documento único, `_id: "default"`) e
      `...service.ts` (get/update + auditoria `MERCADO_LIVRE_PACKAGE_SETTINGS_UPDATE`); rotas
      `GET`/`PUT /api/marketplace-accounts/mercado-livre-package-settings` (só admin) em
      `marketplace-account.routes.ts`; `mercado-livre-package.config.ts` reescrito — `resolvePackage`
      passa a `resolvePackage(db, product)` (assíncrona, lê o banco), sem mais `por_departamento`/
      `por_categoria` (ADR-027: só o padrão, sem exceção — mais simples). Frontend:
      `PackageSettingsCard` em `MarketplaceAccountsPage.tsx` (mesmo padrão do `EncryptionKeyCard`).
      `.env.example` perde `MERCADO_LIVRE_PACKAGE_DEFAULTS`. Testes: 11 no schema compartilhado, 5 em
      `mercado-livre-package.config.test.ts` (reescritos, mock do repositório em vez de env var), 6 de
      integração (`tests/integration/mercado-livre-package-settings.spec.ts` — RBAC, singleton,
      validação, auditoria). `tsc --noEmit`/`eslint` limpos nos três pacotes.

## Fase 5 — Serviços e rotas de anúncio

- [x] T029 `marketplace-listing.service.ts`: `publishListing` sobre `runAccountOperation` e a porta nova,
      aplicando a tabela de transições da spec 3.1 — criar, atualizar, recriar sobre `encerrado`;
      falha parcial (`publicado` + `erro`); falha de atualização que **mantém** `publicado`; recriação
      que falha mantém `encerrado` com `erro`; `publicado_em` atualizado a cada sucesso; auditoria
      `PRODUCT_PUBLISH` sem credencial. Testes unitários, uma linha da tabela por caso — depende de T012,
      T017, T019, T028.
      **Feito** (22/09/2026): rodou à frente de T028 formal — a trava (T019) já bastava para religar
      `publishListing`; usa `marketplaceAccountRepository.findById` direto (falha antes de qualquer trava
      para conta inexistente/errada) e só entra em `runAccountOperation` depois disso. Tabela de transições
      completa (criar/republicar/recriar × sucesso/falha) coberta em testes dedicados.
      **Pendência da ADR-025 fechada (22/09/2026):** `PublishListingInput`/`PublishInput` (porta) e o
      corpo de `POST /marketplace-listings` ganharam `categoryId?: string | null`, repassado como veio até
      o conector — ainda sem efeito real, porque `publish()` do Mercado Livre segue lançando "não
      implementado" (T023/T025). Teste novo confirma a propagação.
- [x] T030 `closeListing` (novo): entrada existe e está `publicado` (senão `ListingNotPublishedError` →
      `409`); conta existe (`404`), ativa e conectada (senão `AccountNotReadyError` → `409` com o passo
      que resolve, **sem** chamar o conector); `runAccountOperation` → `connector.close`; sucesso grava
      `encerrado` + `encerrado_em`, falha mantém `publicado` com `erro` "Falha ao encerrar: …";
      auditoria `PRODUCT_UNPUBLISH` (marketplace, `accountId`, `id_anuncio`, sucesso/erro). Testes
      unitários — depende de T011, T012, T019, T029.
      **Feito** (22/09/2026): 21 testes cobrindo `publishListing`+`closeListing` juntos em
      `marketplace-listing.service.test.ts` (`npx vitest run` verde; `tsc --noEmit`/`eslint` limpos).
- [x] T031 `routes/marketplace-listing.routes.ts`: `POST /api/products/:id/marketplace-listings/close`
      (`admin`/`operator`), corpo `{ marketplace, accountId }` validado por Zod, mapeia 404/409/400 como
      as rotas vizinhas — depende de T030.
      **Feito** (22/09/2026): rota nova registrada; `AccountBusyError` (409) também passou a ser mapeada na
      rota de publicar, que ganhou esse caminho de erro com `publishListing` agora usando a trava.
- [ ] T032 Testes de integração (Fastify + MongoDB em memória, **conector real** com API/OAuth falsos) em
      `tests/integration/marketplace-mercado-livre.spec.ts`: fluxo publicar → republicar → encerrar →
      publicar de novo (id novo); `viewer` recebe `403` em publicar e encerrar; `409` fora de ordem;
      auditoria sem credencial; `publishedListingsCount` correto por conta (inclui produto `vendido`);
      par de tokens renovado é gravado mesmo quando a operação falha depois; duas publicações
      simultâneas na mesma conta gastam o `refresh_token` uma vez só; desconectar durante a operação
      descarta o par novo; desativar/desconectar/apagar conta com anúncio no ar continua permitido —
      depende de T014, T031.

## Fase 6 — Frontend

- [x] T033 Serviço e hook: `closeListing` em `services/marketplace-listing.service.ts` e `useCloseListing`
      em `hooks/useMarketplaceListings.ts` (invalida a query do produto) — depende de T031.
      **Feito** (22/09/2026).
- [x] T034 `features/products/PublishToMarketplace.tsx`: badge "Encerrado"; "Ver anúncio" só em
      `publicado`; entrada `publicado` com `erro` mostra o aviso de pendência; o botão principal vira
      "Republicar no Mercado Livre" quando a conta escolhida já tem entrada `publicado`; "Encerrar
      anúncio" por linha, com confirmação inline (texto da spec 011, seção 4.7) e o erro da API visível
      — depende de T011, T033.
      **Feito** (22/09/2026): badge "Encerrado" com "Anúncio encerrado em <data>"; "Ver anúncio" só em
      `publicado`; aviso de pendência (`erro` com `publicado`) visível; botão principal vira "Republicar no
      X" quando a conta+marketplace escolhidos já têm entrada `publicado` (só o rótulo — quem decide criar ×
      atualizar continua sendo o backend/conector, spec 012 seção 3.1); "Encerrar anúncio" por linha com
      `window.confirm` (texto exato da spec 011, seção 4.7) e erro da API visível. `tsc --noEmit`/`eslint`
      limpos; sem teste de componente dedicado (nenhum existia antes desta tarefa nesse arquivo).
- [x] T059 Tela de revisão de categoria (spec 012, seção 4; ADR-025) — novo passo entre "Publicar"/
      "Republicar" e a publicação de fato, em toda tentativa (não só na criação): ao clicar, chama T058
      (`POST /marketplace-category-suggestion`), mostra a categoria sugerida pré-selecionada e um
      `<select>` com a lista curada (T057); operador confirma ou troca; só então chama
      `POST /marketplace-listings` com o `categoryId` escolhido no corpo. Preditor indisponível → mostra a
      tela igual, sem pré-seleção, sem travar. Pode viver como um passo dentro de
      `PublishToMarketplace.tsx` ou um modal próprio — decisão de implementação. Depende de T058; muda o
      corpo que `usePublishListing`/`marketplaceListingService.publish` envia (novo campo `categoryId`).
      **Feito** (22/09/2026): passo dentro de `PublishToMarketplace.tsx` (sem modal separado) — clicar em
      "Publicar"/"Republicar no Mercado Livre" chama `useCategorySuggestion` (novo hook); a resposta abre um
      painel de revisão substituindo os controles normais, com a sugestão em destaque (ou aviso de que não
      houve sugestão), um campo de filtro de texto (207 categorias — T057 — filtrado por nome) e o
      `<select>` pré-selecionado; "Confirmar e publicar" chama `usePublishListing` com `categoryId`;
      "Cancelar" reseta a revisão sem publicar. Falha de `publish` **mantém** o painel aberto com a seleção
      feita, para tentar de novo sem repetir a revisão. Só o Mercado Livre passa por este fluxo — outros
      marketplaces (sem esse passo ainda) publicam direto, como antes. `marketplaceListingService.publish`
      e a `PublishListingBodySchema`/`PublishInput`/`PublishListingInput` (backend) ganharam `categoryId`
      opcional, repassado até o conector (ainda sem efeito, T023/T025 pendentes). `tsc --noEmit`/`eslint`
      limpos nos dois pacotes; sem teste de componente dedicado (mesma lacuna pré-existente da T034).
      **Ampliado com T010 (ADR-026, 22/09/2026):** o mesmo painel ganhou um segundo `<select>` — tipo de
      anúncio, lista estática de `MERCADO_LIVRE_LISTING_TYPES` (`frontend/src/schemas/marketplace-account.schema.ts`),
      sempre pré-selecionado em "Grátis" (mais barato); `listingTypeId` viaja junto do `categoryId` até o
      conector (mesma porta, mesmo "ainda sem efeito").
      **Bug real corrigido no T043 (22/09/2026):** a sugestão do preditor pode cair fora da lista curada
      (aconteceu de verdade: "Item de Teste – Por favor, NÃO OFERTAR!" confundiu o preditor com "Kits Teste
      Ph e Cloro", uma categoria de piscina) — o painel pré-selecionava um `categoryId` que não existia
      entre as `<option>` do `<select>`, então o navegador mostrava silenciosamente a primeira opção da
      lista enquanto o texto "Sugestão do Mercado Livre" seguia citando o valor errado. Corrigido: só
      pré-seleciona quando a sugestão está de fato na lista curada; fora disso, mostra um aviso âmbar
      pedindo escolha manual.
- [x] T061 Tela de revisão de tamanho de calçado (spec 012, seção 4; achado real 24/09/2026) — pedido
      do usuário depois de "muitas peças" ficarem de fora do Mercado Livre por erro cru de "tamanho não
      encontrado na tabela". Mesmo painel de T059, novo passo depois da categoria confirmada: chama
      `POST /marketplace-size-suggestion` (novo, com o `categoryId` já escolhido) e, só se `applicable`,
      mostra um `<select>` com os tamanhos reais da tabela `BRAND`/`STANDARD` (pré-seleciona quando o
      tamanho do cadastro já bate, `currentMatches`); sem tabela nenhuma, avisa e bloqueia "Confirmar e
      publicar" (evita um erro que já se sabe que vai acontecer). Roupa nunca aciona isso — cria a
      própria linha (seção 3.5), nunca "não encontra".
      **Backend:** `mercado-livre-item.mapper.ts` ganhou `availableSizeLabels` (extrai os rótulos de
      `SIZE` de uma tabela); `mercado-livre-publish.ts` ganhou `findFootwearChart` (extraído de
      `resolveFootwearChart`, busca `BRAND` depois `STANDARD`, reaproveitado pelos dois fluxos) e
      `resolveFootwearSizeSuggestion` (exportada, só consulta); `mercado-livre.connector.ts` ganhou
      `suggestFootwearSizes` (mesmo padrão de `suggestCategory`, fora da `MarketplaceConnectorPort`);
      novo `marketplace-size-suggestion.service.ts` — **diferente da sugestão de categoria, uma falha
      real (rede, token) propaga, não vira "sem sugestão em silêncio"**: não é uma previsão dispensável,
      é o dado que decide se a publicação vai falhar. Nova rota
      `POST /:id/marketplace-size-suggestion`. `PublishInput`/`PublishListingInput`/
      `PublishListingBodySchema` ganharam `sizeOverride` opcional — tem prioridade sobre
      `tamanho_etiqueta`/`tamanho_equivalente` só pra aquela publicação, nunca gravado no cadastro.
      Mensagem de erro de "tamanho não encontrado" (fallback, se a publicação for chamada sem passar
      pela revisão) passou a listar os tamanhos disponíveis também.
      **Frontend:** `useSizeSuggestion` (novo hook); `PublishToMarketplace.tsx` consulta a sugestão toda
      vez que a categoria muda (pré-seleção inicial e troca manual) — imperativo, sem `useEffect`, mesmo
      estilo do resto do arquivo.
- [x] T062 Revisão de frete (spec 012, seção 4; achado real 24/09/2026) — publicar sem declarar
      `shipping` deixou o Mercado Livre aplicar um padrão próprio (achado real: anúncio publicado com
      "envio por conta do comprador" e aviso sobre o modo `me1` não estar ativado na conta). Pedido do
      usuário: caixa de seleção **dinâmica** (não estática) pro operador escolher o tipo de frete,
      consultando o Mercado Livre antes de oferecer — mesmo rigor da revisão de categoria/tamanho, nunca
      oferece uma opção que pode não valer pra aquele item.
      **Documentação com lacuna real**: o exemplo de `curl` de `POST /users/{sellerId}/shipping_modes`
      está malformado nas duas fontes oficiais (en_us e es_ar) — sem `-H` nos headers extras
      (`x-multichannel`, `X-Format-New`), sem corpo antes da URL. O formato do corpo implementado segue
      o JSON de exemplo (completo, consistente nas duas fontes), não o `curl`. **Ainda não confirmado
      contra a API real** (sem token de acesso válido neste ambiente de execução).
      **Backend:** `mercado-livre-api.client.ts` ganhou `getShippingModes` (`request()` ganhou suporte a
      headers extras); achata `channels.marketplace.available_modes[].logistic_types[]` numa lista de
      opções, mantendo o vocabulário cru do Mercado Livre pros campos `free_shipping`/`costs`
      (`"mandatory"`/`"required"`/`"optional"`/`"not_allowed"` já confirmados em exemplos oficiais
      diferentes — nunca normalizado num enum fechado, pra não inventar significado pra um valor novo).
      `mercado-livre-item.mapper.ts` ganhou `topLevelCondition` (campo `condition` de
      `getShippingModes`, vocabulário diferente do atributo `ITEM_CONDITION`) e `shipping` em
      `buildCreatePayload`/`buildUpdatePayload`. `mercado-livre-publish.ts` ganhou
      `resolveShippingSuggestion` — usa um subconjunto mais leve de atributos (condição, marca, pacote)
      em vez de `buildAttributes` completo, pra não depender de tamanho/GTIN ainda não resolvidos nesse
      ponto da revisão. `mercado-livre.connector.ts` ganhou `suggestShipping` (mesmo padrão de
      `suggestFootwearSizes`); novo `marketplace-shipping-suggestion.service.ts` (mesma regra da
      sugestão de tamanho: falha real propaga, não é previsão dispensável). Nova rota
      `POST /:id/marketplace-shipping-suggestion`. `PublishInput`/`PublishListingInput`/
      `PublishListingBodySchema` ganharam `shipping` opcional (`{mode, logisticType, freeShipping}`).
      **Frontend:** `useShippingSuggestion` (novo hook); `PublishToMarketplace.tsx` consulta toda vez
      que categoria ou tipo de anúncio mudam, pré-seleciona a opção `default`, mostra um checkbox de
      frete grátis só quando a opção escolhida permite mas não exige. **Nunca bloqueia a publicação** —
      diferente do tamanho (T061): se a consulta falhar ou não achar opção, publica sem `shipping`
      (mesmo comportamento de antes desta funcionalidade existir).
- [ ] T035 `features/products/ActiveListingsNotice.tsx` (novo): aviso "esta peça tem anúncio no ar" com
      "Encerrar anúncios e continuar" / "Continuar sem encerrar" / "Cancelar"; encerra em sequência e, se
      algum encerramento falhar, para, mostra o erro e **não** muda o status da peça — depende de T033.
- [ ] T036 `pages/products/ProductsPage.tsx`: usa o aviso antes de "Marcar como vendida" e "Desativar"
      quando o produto tem entrada `publicado` — depende de T035.
- [ ] T037 `pages/products/ProductFormPage.tsx`: usa o aviso ao salvar mudando o status para `vendido` ou
      `inativo` (o formulário permite editar o status) — depende de T035.
- [ ] T038 `pages/admin/MarketplaceAccountsPage.tsx`: coluna "Anúncios no ar" e
      `publishedListingsCount` no texto da confirmação de **Desconectar** e de **Apagar** (só avisa, não
      bloqueia — ADR-022, adendo) — depende de T014.

## Fase 7 — E2E com servidor falso

- [ ] T039 `e2e/fake-mercado-livre.ts`: servidor HTTP em porta local com respostas roteirizáveis por teste
      (categorias, criação, atualização, descrição, encerramento, erros); o backend do `webServer` do
      Playwright sobe com `MERCADO_LIVRE_API_BASE_URL` apontando para ele — depende de T028.
- [ ] T040 Helper de `global-setup` que cria uma conta do Mercado Livre **já conectada** direto no banco
      de teste, com credencial cifrada e tokens válidos (o OAuth de navegador não é automatizável) —
      depende de T039.
- [ ] T041 `e2e/tests/marketplace-mercado-livre.spec.ts`: publicar, republicar e encerrar pela tela; aviso
      ao marcar como vendida com anúncio no ar (encerrar e continuar / continuar sem encerrar /
      cancelar); confirmação de Desconectar mostrando "N anúncio(s) no ar" — depende de T036, T038, T040.
      Roda contra o cluster de teste do Atlas (`e2e/AGENTS.md`).

## Fase 8 — Verificação manual contra o Mercado Livre real

Fecha a Fase 0 com evidência. Publicar cria um anúncio **real**: usar uma peça de teste e encerrá-la
no mesmo dia.

- [x] T042 Preparar o teste real com **usuário de teste** (o Mercado Livre não tem sandbox): criar o usuário
      de teste vendedor (`POST /users/test_user`, `{"site_id":"MLB"}`) e **guardar** apelido e senha; pedir a
      ambientação ao modelo *User Products* pelo formulário da documentação (ativação a cada 7 dias); cadastrar
      a conta no ERP com o Client ID/Secret do app e conectá-la por OAuth logando como o usuário de teste;
      registrar o resultado — status "Conectada" e renovação de token funcionando — depende de T004, T032.
      **Andamento (21/09/2026):** conta real conectada no ambiente de desenvolvimento (token válido, tag
      `user_product_seller` presente); usuário de teste vendedor **criado** (id 3699839278; credenciais em
      `humandevnotes.md`, ignorado pelo git). Faltam o formulário de ambientação ao modelo *User Products* e conectar
      o usuário de teste por OAuth.
      **Decisão (22/09/2026):** o usuário pediu para **não** criar/conectar a conta de teste — os testes da
      Fase 8 (T043/T044) rodaram direto na conta de produção já conectada (`OpenERPSampleProject`). Cada anúncio de
      teste foi criado e encerrado no mesmo dia, como a spec já previa para minimizar o risco. Formulário de
      ambientação ao *User Products* segue preenchido (não chegou a ser usado).
- [x] T043 Publicar uma peça de teste — título "Item de Teste – Por favor, NÃO OFERTAR!", categoria "Outros",
      escolhendo na revisão um tipo de anúncio diferente de `gold`/`gold_premium` (ADR-026) — e conferir o
      anúncio no Mercado Livre (nome/título, preço, fotos, descrição, dimensões do pacote, tipo de anúncio)
      — depende de T009, T041, T042. Aproveitar para **confirmar a ordem de custo real** dos tipos de
      anúncio (ADR-026, ordem hoje só conceitual).
      **Feito** (22/09/2026), na conta de produção (T042). Categoria "Outros" não existe na lista curada
      (T057, restrita a Roupas/Calçados/Bolsas) — usada uma categoria de moda real (`MLB190393`, "Cintos") em
      vez disso. Publicação criada com sucesso: `id_anuncio` e `url_anuncio` reais, `listing_type_id: "free"`.
      **Muitos bugs reais encontrados e corrigidos ao vivo** (todos com teste de regressão):
      1. `domain_id` enviado a `POST /catalog/charts/search`/`POST /catalog/charts` precisa vir **sem** o
         prefixo do site (`"SHORTS"`, não `"MLB-SHORTS"`) — só esses dois endpoints; o resto da API usa o
         prefixo. Sem a correção: `"Domain MLB-MLB-SHORTS not active"`.
      2. Nome da tabela `SPECIFIC` (`buildChartName`) não podia ter "—" (em-dash) — só letras/números/espaço,
         apesar do exemplo da spec 012, seção 3.5, mostrar um "—".
      3. Linha de tabela `SPECIFIC` precisa do atributo `FILTRABLE_SIZE` (espelha `SIZE`) — não documentado
         em nenhuma fonte salva.
      4. `MercadoLivreApiError`: `cause` às vezes não é array — `(body?.cause ?? [])` sem `Array.isArray()`
         quebrava com `"(...).map is not a function"` quando um item foi removido do Mercado Livre e o erro
         veio num formato diferente. Também descoberto um formato alternativo, `errors` (sem `type`, visto em
         `/catalog/charts`), agora tratado como sempre bloqueante.
      5. `colorAttribute` priorizava `MAIN_COLOR` sobre `COLOR`; a categoria testada tinha os dois, com só
         `COLOR` `required` — virou `colorAttributes` (plural), enviando os dois quando os dois existem.
      6. `SIZE`/`GENDER` só eram enviados quando o domínio tinha tabela de medidas (`active_domains`);
         confirmado que podem ser atributos comuns exigidos **sem** envolver tabela nenhuma (categoria
         "Cintos") — agora sempre enviados quando mapeáveis, independente da tabela.
      7. Atributo `MODEL` (texto livre, "nome específico do produto") exigido por muitas categorias de
         acessórios, sem fonte nenhuma no ERP — **decisão do usuário**: reaproveitar `identificacao.nome`
         (dado real, nunca inventado). `modelAttribute` novo no mapeador.
      8. Departamento "Unissexo" (003) não batia com nenhum valor de `GENDER` do Mercado Livre — sinônimo
         `"unissexo" → "sem gênero"` adicionado a `genderAttribute` (único par confirmado; qualquer outro
         departamento sem correspondência continua `null`).
      9. `getDomainSizeChartAttributes`: a estrutura real de `technical_specs` tem **dois** níveis de
         `components` aninhados (`groups[].components[].components[].attributes[]`), não um só — corrigido,
         mas mesmo corrigido **não revelou nenhum atributo `GARMENT_*`** para o domínio testado — ver a
         pendência nova registrada na ADR-024 (bloqueia publicar roupa com tabela de medidas; não afeta
         calçado nem moda sem tabela).
      **UI corrigida também**: a sugestão do preditor pode cair fora da lista curada (ex.: "Item de Teste"
      confundiu o preditor com "Kits Teste Ph e Cloro") — o painel de revisão pré-selecionava um valor que
      não existia no `<select>`; agora só pré-seleciona quando a sugestão está na lista curada, e avisa o
      operador quando não está.
- [x] T044 Republicar (mudando o preço) e **encerrar**; conferir que o anúncio saiu do ar e que o ERP
      mostra "Encerrado"; registrar o que o Mercado Livre devolveu — em especial o formato real do *warning*
      de preço ignorado (`warnings` da resposta do `PUT`), a resposta do encerramento e o efeito do
      `sandbox_mode` — depende de T043.
      **Feito** (22/09/2026): republicar (preço alterado) manteve `status: publicado` e o mesmo `id_anuncio`,
      com *warnings* reais capturados como pendência (`AGE_GROUP` sugerido automaticamente pelo Mercado
      Livre — a spec 012, seção 3.5, já previa isso; e um aviso de frete grátis). Encerrar funcionou de
      ponta a ponta (`status: encerrado`, `encerrado_em` preenchido, `erro: null`); encerrar de novo depois
      é rejeitado com `409` pelo próprio serviço (`ListingNotPublishedError`), antes de chamar o conector —
      confirma o guard de idempotência no nível certo.
      **Bug real encontrado e corrigido**: `family_name` (modelo *User Products*) **nunca** pode ser
      reenviado em `PUT /items/{id}` — o Mercado Livre rejeita com `"The field family name is invalid"`
      mesmo reenviando o valor idêntico ou um texto simples sem acento. Contradiz a suposição original da
      spec 012, seção 3.1 ("editável enquanto sold_quantity = 0"). `buildUpdatePayload` corrigido para nunca
      incluir `family_name`; `title` (modelo antigo) mantém a regra original, não testada ao vivo (a conta
      de produção já está no modelo novo).
      **`sandbox_mode`**: sem efeito observado — os anúncios de teste foram criados/encerrados normalmente
      como anúncios reais, confirmando a T009 (Mercado Livre não tem sandbox de verdade).
- [ ] T049 Primeira **publicação real** (uma peça de verdade na conta da loja — a conta de produção é a que já está
      conectada, `user_id` 1234567890, decisão de 21/09/2026 — com o tipo de anúncio decidido
      em T010): é uso, não teste; conferir e, se algo divergir do teste, registrar — depende de T010, T044, T051, T053.
      **Nota (22/09/2026):** já **desbloqueada tecnicamente** para categorias sem tabela de medidas (moda
      sem `active_domains`, calçado `SAPT` com tabela `BRAND`/`STANDARD`) — T043/T044 validaram o caminho
      completo. Categorias de roupa com tabela de medidas (`SPECIFIC`) continuam bloqueadas pela pendência
      da ADR-024 (origem dos atributos `GARMENT_*` não encontrada). Falta só T051 (valores reais do pacote
      — a tela já está pronta, só precisa dos números reais; os usados no teste foram um placeholder
      pequeno, 5×20×15 cm / 2 g).
- [ ] T045 Documentação: registrar na [spec](spec.md) o que a Fase 8 confirmou (formato do *warning*, resposta
      do encerramento, `sandbox_mode`, decisões de T008 e T010); mudar o `Status` da spec de Draft para o
      estado real; registrar em `specs/011-integracao-marketplaces/tasks.md` uma fase nova com a
      mudança de contrato (porta e `MarketplaceListingSchema`) e corrigir a assinatura da porta em
      `specs/011-integracao-marketplaces/plan.md` (seção 5, passo 2) — depende de T049.

## Dependências entre tarefas

```
T001 → T002, T003 → T004                      (Fase A, já entregue)
T005, T006, T007, T008 → T022                 (todas confirmadas)
T008, T052, T054, T056 → T023                 (T054 decidida — ADR-025; T056 é a extensão de medidas)
T015 → T052
T023, T024 → T025, T026    T022, T024 → T027
T010 → T049    T009 → T043
T054 → T057 → T058, T059   T022, T057 → T058   T058 → T059

T011 → T015, T029, T030, T034
T012 → T029, T030
T013 → T014 → T032, T038
T015 → T016 → T017
T015, T018 → T019 → T020
T019, T017, T012, T028 → T029 → T030 → T031 → T032
T001 → T021 → T024
T015, T021, T022 → T024
T016, T025, T026, T027 → T028
T031 → T033 → T034, T035 → T036, T037
T059 → T034                                    (categoryId no corpo de publicar — ver nota da T029)
T028 → T039 → T040 → T041   (T036, T038 também alimentam T041)
T004, T032 → T042 → T043 → T044 → T049 → T045
T051 → T049
```

## Nota

T005 a T009, T046 a T048 e T050 estão confirmados, decididos ou medidos. O que mais mudou o desenho: o
**modelo *User Products*** (`family_name` no lugar de `title`), o **SKU em `SELLER_SKU`**, o **pacote padrão
configurável** (T046) e o fato de o Mercado Livre **não ter sandbox** (a Fase 8 usa usuário de teste). A
**conta de produção** é a que já está conectada (decisão de 21/09/2026).

O T050 mudou o escopo de roupas: **nenhum domínio de roupa tem tabela de medidas pronta** (só calçados). A
decisão **T053** (ADR-024, 22/09/2026) foi o ERP **criar/estender** tabelas `SPECIFIC` por API, alimentadas
pelas medidas reais de cada peça — o que exigiu **T056** (feita, 22/09/2026), a extensão de `medidas` (`coxa`,
`entrepasso`) para cobrir os atributos `GARMENT_*` que o Mercado Livre pede em calças/shorts/saias; partes de
cima ainda dependem de confirmar `technical_specs` na implementação. Junto veio a decisão **T054**
(ADR-025, 22/09/2026, ver acima) — o preditor de categorias errou o domínio de peças comuns; a resposta não
foi um mapeamento configurável, foi tornar a revisão humana **obrigatória em toda publicação** — e o requisito
de que o `tamanho_etiqueta` seja obrigatório para publicar moda (hoje 7 de 9 produtos de dev não têm).

22/09/2026: **Fases 4 e 5 implementadas** (menos o mapeador/criar/atualizar) — T021, T022, T024 (com
`publish()` ainda "não implementado"), T027, T029, T030, T031, T033, T034, T052, T056, T057, T058, T059
concluídas; conector Mercado Livre registrado no bootstrap. `close()` (encerrar anúncio) e a **revisão
obrigatória** de categoria (T054/ADR-025 — sugestão do preditor + confirmação numa lista curada de 207
categorias-folha) **e** de tipo de anúncio (T010/ADR-026 — lista estática do mais barato ao mais caro,
`free` pré-selecionado, no mesmo painel) funcionam de ponta a ponta, backend e frontend; `categoryId` e
`listingTypeId` já viajam até o conector (`PublishInput`/`PublishListingInput`/corpo da rota), sem efeito
real ainda. **T010 decidida** — sem mais bloquear T043, só a ordem de custo (conceitual, não confirmada
por preço real) fica pendente de confirmação na própria Fase 8.

Ainda 22/09/2026: **T046/T052 refeitas (ADR-027)** — por pedido do usuário, o pacote padrão do Mercado
Livre deixou de ser a variável de ambiente `MERCADO_LIVRE_PACKAGE_DEFAULTS` (com prioridade
categoria/departamento/padrão) e virou uma tela de admin ("Contas de marketplace → Pacote padrão do
Mercado Livre") gravando um único pacote no banco — mais simples (sem exceção por categoria/departamento,
princípio V), `peso_g` sempre obrigatório (elimina uma categoria de falha inteira). `resolvePackage` agora
é assíncrona (`resolvePackage(db, product)`).

22/09/2026 (mais tarde): **T023, T025, T026 concluídas — `publish()` funciona de ponta a ponta.**
`mercado-livre-item.mapper.ts` (T023, funções puras, 51 testes) e `mercado-livre-publish.ts` (T025/T026,
orquestração de criar/atualizar sobre a API real, 42 testes) fecham o conector: criar (com adoção por SKU
em caso de resposta perdida), atualizar (respeitando `sold_quantity > 0`), GTIN (`required`/
`conditional_required`), moda com tabela de medidas (calçado via `BRAND`/`STANDARD`, roupa via `SPECIFIC`
— cria tabela e/ou linha conforme falte), preço fora da faixa, categoria sem `listing_allowed`, warnings
viram pendência, descrição com queda de `PUT` para `POST`. A categoria→domínio vem de
`settings.catalog_domain` (`GET /categories/{id}`, campo novo confirmado contra a API real); calçado ×
roupa é decidido pela própria `categoria_codigo` do ERP (`SAPT` = calçado), não por inferência da
taxonomia do Mercado Livre.

22/09/2026 (Fase 8, T042–T044): **testado ao vivo contra a conta de produção real** (o usuário decidiu não
criar a conta de teste — cada anúncio de teste foi criado e encerrado no mesmo dia). Criar, republicar
(com preço alterado) e encerrar **funcionam de ponta a ponta**, com `id_anuncio`/`url_anuncio` reais,
*warnings* capturados como pendência (inclusive o `AGE_GROUP` que a spec 012, seção 3.5, já previa), e o
encerramento repetido corretamente rejeitado com `409` pelo próprio serviço. Isso só valeu para uma
categoria **sem** tabela de medidas (moda fora de `active_domains`) — categorias de roupa com tabela de
medidas continuam bloqueadas pela pendência nova do T060 (ver abaixo). No caminho, **8 bugs reais** foram
encontrados e corrigidos, todos com teste de regressão (detalhes nas notas de T022/T023/T025/T026/T044 e
na ADR-024): prefixo duplicado no `domain_id` de `/catalog/charts`, nome de tabela rejeitado por causa do
"—", `FILTRABLE_SIZE` não documentado, `cause`/`errors` não-array quebrando o parser de erro,
`COLOR`/`MAIN_COLOR` só um dos dois sendo enviado, `MODEL` sem fonte no ERP (decisão: reaproveitar o nome
do produto), sinônimo "Unissexo"/"Sem gênero" faltando, e `family_name` nunca podendo ser reenviado numa
atualização (contradizia a spec original). A tela de revisão também ganhou uma correção real: a sugestão
do preditor pode cair fora da lista curada, e o painel pré-selecionava um valor inexistente no `<select>`
sem avisar o operador.

**Duas pendências na spec 012 na época** (ver adendo 23/09 abaixo para o que mudou): **T060** (achar de
onde vêm os atributos `GARMENT_*` exigidos pela tabela `SPECIFIC` — `technical_specs` não tem, confirmado
ao vivo; bloqueia só roupa com tabela de medidas) e **T051** (a dona do brechó preenche a tela do pacote
padrão com valores reais — os do teste foram um placeholder pequeno, 5×20×15 cm/2 g). T049 (primeira
publicação real de uso, não teste) já estava tecnicamente desbloqueada para categorias sem tabela de
medidas.

23/09/2026: **primeira publicação real de uso** (não teste) esbarrou em mais achados, corrigidos com
regressão em cada um — nenhum bloqueia mais nada:
1. `productRepository` (backend) nunca revalidava o documento do Mongo contra `ProductSchema` — só um
   cast de TypeScript. Um produto anterior à spec 011 (`marketplaces` no formato antigo, objeto fixo por
   marketplace) quebrava `publishListing` com `product.marketplaces.find is not a function`, e mesmo
   corrigida a leitura, a gravação (`$push`) também quebrava (`must be an array but is of type object`).
   Dois fixes: `toProduct()` sempre reparseia; `upsertMarketplaceListing` virou um pipeline update
   (`$isArray`/`$concatArrays`) para o caso de criar a primeira entrada.
2. `mercado-livre-category-catalog.json` (T057) está commitado em `src/`, mas o `tsc` não copia `.json`
   para `dist/` — funcionava em dev (`tsx` roda direto de `src/`) e nos testes, mas faltava na imagem
   Docker de produção. Corrigido com um `postbuild` em `backend/package.json`.
3. `MARKETPLACE_CREDENTIAL_MASTER_KEY` (ADR-021, spec 011) nunca foi configurada no Container App de
   produção — lacuna do `infra/aca/README.md`, escrito antes dessa variável existir. Configurada e
   documentada.
4. **Gênero da peça**: a categoria real "Scarpins e Plataformas" exige `GENDER` e só aceita
   Feminino/Meninas — sem opção "Sem gênero". O departamento "Unissexo" (categoria inteira, spec 003) não
   é preciso o bastante para essas categorias. **Decisão do usuário**: em vez de escolher na tela de
   revisão (mesmo padrão de categoria/tipo de anúncio), um campo `caracteristicas.genero` explícito no
   cadastro (spec 005, seção 2) — ver [glossário](../../memory/glossary.md#gênero-peça). `genderAttribute`
   agora tenta `genero` primeiro (mapeamento fechado e determinístico), com fallback pro heurístico de
   departamento (comportamento antigo preservado para produtos sem `genero` preenchido).
5. **Calçado sem tabela `BRAND`/`STANDARD`**: confirmado ao vivo que "Scarpins e Plataformas"
   (`MLB-HEELS_AND_WEDGES`) não tem nenhuma das duas — comportamento correto e já documentado (seção 3.5:
   "calçado" nunca cria tabela própria, só roupa). Das categorias curadas, só 3 calçados têm tabela
   `STANDARD` confirmada: Botas (`BOOTS_AND_BOOTIES`), Tênis (`SNEAKERS`) e Sapatos Sociais e Mocassims
   (`LOAFERS_AND_OXFORDS`) — nenhuma descreve bem um scarpim/salto. **Decisão do usuário**: sem mudança de
   código; escolher categoria com tabela quando o encaixe permitir, senão a peça fica sem publicar no
   Mercado Livre.
6. **T060 confirmado também em domínio de parte de cima** — publicar um casaco esbarrou em
   `"Required attribute GARMENT_CHEST_WIDTH_FROM was not found in row SIZE 48 - MEDIO"`, erro cru do
   Mercado Livre vazando pro operador (mesma causa raiz do T060: `technical_specs` não lista o atributo,
   então o pré-checo do ERP não bloqueia antes da chamada real). Pior que calças/shorts: `busto` nem
   existe em `MedidasSchema`, e a spec já previa que partes de cima podem pedir mais medidas ainda não
   confirmadas (ombro, manga). **Decisão do usuário**: não investir agora — ver nota no T060 acima.

23/09/2026 (mais tarde, mesmo dia): **T060 resolvida** — causa raiz achada via documentação oficial do
Mercado Livre (não tentativa e erro contra a API real, ver nota completa no T060 acima). Resumo: a ficha
técnica de medidas (`technical_specs`) é indexada por **gênero**, não só por domínio — os atributos
`GARMENT_*` são `CHILD_DEPENDENT` do `GENDER` e só aparecem numa consulta `POST` (não `GET`) com o
`GENDER` já resolvido no corpo. `getDomainSizeChartAttributes` corrigida; teste de regressão cobrindo o
`POST`+corpo. **Ainda não confirmado contra a API real** — próxima publicação de calça/short confirma.
Se confirmado, resolve o bloqueio de roupa com tabela de medidas por completo (exceto partes de cima, que
ainda dependem de mapear `busto`/possivelmente ombro/manga em `MedidasSchema` — decisão de não investir
nisso por ora continua de pé).

24/09/2026: **T061 — revisão de tamanho de calçado**. Erro real e
recorrente reportado pelo usuário ("A tabela de medidas do Mercado Livre não tem o tamanho 'BR 38' para
'MLB-SNEAKERS'") virou uma pergunta direta: dá pra mostrar os tamanhos disponíveis pra escolher, em vez
de só um erro sem saída? Resposta: sim, a tabela `BRAND`/`STANDARD` já é buscada antes de falhar — só
faltava expor isso numa tela em vez de descartar depois de usar. Implementado como um passo a mais no
mesmo painel de revisão de categoria/tipo de anúncio (T059/T010), proativo (decisão do usuário — mostra
antes de tentar publicar, não só depois de falhar). Ver detalhes completos no T061 acima.

24/09/2026 (mesmo dia, primeira publicação real após T060/T061): **T062 — revisão de frete**. O
anúncio publicou com sucesso (confirmação real de T060 e T061 funcionando), mas ficou com "envio por
conta do comprador" e um aviso sobre o modo `me1` não estar ativado na conta — o conector nunca
declarava `shipping` no `POST /items`, então o Mercado Livre aplicava um padrão próprio. Pedido do
usuário, com uma condição explícita: caixa de seleção **dinâmica** (não estática), consultando o
Mercado Livre antes de oferecer — mesmo padrão de rigor já estabelecido pra categoria/tamanho.
Documentação oficial (`POST /users/{sellerId}/shipping_modes`) tinha o mesmo tipo de lacuna já visto
no T060 (exemplo de `curl` malformado) — implementado a partir do JSON de exemplo, que estava completo
e consistente nas duas fontes (en_us/es_ar) mesmo com o `curl` quebrado. Ver detalhes completos no
T062 acima. **Ainda não confirmado contra a API real.**

24/09/2026 (mesmo dia, produto real em produção): **T063 — GARMENT_* de ombro/manga e variantes
`_TO`**. Publicar uma jaqueta de couro esbarrou exatamente na lacuna que o T060 já havia previsto
("partes de cima podem exigir mais medidas — ombro, manga — sem atributo `GARMENT_*` confirmado"):
erro real listando `GARMENT_CHEST_WIDTH_TO`, `GARMENT_LENGTH_TO`, `GARMENT_SHOULDER_WIDTH_FROM/TO`
e `GARMENT_SLEEVE_LENGTH_FROM/TO` como exigidos e ainda não capturados pelo cadastro. Confirmado e
mapeado: `medidas.largura_ombro` (novo campo) → `GARMENT_SHOULDER_WIDTH_FROM/TO`,
`medidas.comprimento_manga` (novo campo) → `GARMENT_SLEEVE_LENGTH_FROM/TO`; `busto` e `comprimento`
ganharam as variantes `_TO` apontando pro mesmo campo que já tinham em `_FROM` — cada peça é única,
`_FROM`/`_TO` do mesmo atributo sempre mandam o mesmo valor (constituição, princípio X), nunca uma
faixa de verdade. `garmentMeasureAttributes`/`GARMENT_MEASURE_BY_ATTRIBUTE` não precisaram de
nenhuma mudança estrutural — só de entradas novas no mapa, a máquina genérica já existia desde o
T053/T060. Os dois campos novos passaram pelos três lugares do contrato de IA (spec 006, seção
5) — schema (`shared/schemas/ai-intake.schema.ts`), prompt (`RESPONSE_SCHEMA_TEMPLATE`) e
mapeamento pra revisão (`aiSuggestionToFormValues`) — evitando repetir a divergência do T060.
Ver [005/spec.md](../005-produtos-cadastro-manual/spec.md#2-modelo-de-dados) e seção 3.5 acima
para o modelo de dados e a tabela `GARMENT_*` atualizados.
