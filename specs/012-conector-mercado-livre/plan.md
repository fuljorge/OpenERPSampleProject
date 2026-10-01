# Plan 012 — Conector Mercado Livre

**Spec:** [spec.md](spec.md)
**Constituição:** [memory/constitution.md](../../memory/constitution.md)
**Depende de:** [011-integracao-marketplaces/plan.md](../011-integracao-marketplaces/plan.md)
(contas, porta, publicação), [005-produtos-cadastro-manual/plan.md](../005-produtos-cadastro-manual/plan.md),
[008-auditoria/plan.md](../008-auditoria/plan.md)

## 1. Stack técnica

| Camada | Tecnologia |
|---|---|
| HTTP para o Mercado Livre | `fetch` nativo do Node (o mesmo de `mercado-livre-oauth.client.ts`), timeout de 15 s por chamada — sem SDK nem biblioteca nova (constituição, princípio V) |
| Serialização por conta | Trava (*lease*) no próprio documento de `marketplace_accounts` no MongoDB — sem Redis nem fila (princípio V) |
| Validação | Zod (respostas do Mercado Livre lidas defensivamente; o que não for reconhecido vira erro claro, nunca `undefined` propagado) |
| Frontend | React + TanStack Query — mesmas telas de 011 (`PublishToMarketplace`, `MarketplaceAccountsPage`, `ProductsPage`) |
| Configuração | `MERCADO_LIVRE_API_BASE_URL` (padrão `https://api.mercadolibre.com`; existe para os testes E2E apontarem para um servidor falso — produção não define) é a **única** variável de ambiente específica do conector. Pacote padrão (spec 3.4; ADR-027) e tipo de anúncio (spec 3.2; ADR-026) **não** são variáveis de ambiente — o pacote é editado numa tela de admin e gravado no banco, o tipo de anúncio o operador escolhe a cada publicação |

## 2. Contexto técnico

Esta spec entrega o **primeiro adaptador real** atrás da porta de 011 e, junto com ele, as duas
mudanças de contrato que só ficam concretas com um conector de verdade:

1. **A porta de 011 muda** (spec 011, seção 4.1): `publish` passa a criar *ou atualizar*, ganha
   `close`, e as duas devolvem `updatedCredential` (no resultado **e** no erro). O contrato antigo
   `publish(product, account, credential)` descrito em `plan.md` da 011 (seção 5, passo 2) é
   **substituído** por este — os dublês dos testes de 011 são migrados (passo 2 abaixo).
2. **O status `encerrado`** entra no schema compartilhado (011, seção 4.2).

Decisões de projeto que orientam o resto do plano:

- **Onde mora cada coisa** (cadeia obrigatória do `backend/AGENTS.md`): o **adaptador** só fala
  HTTP e monta payloads (`plugins/marketplaces/`); **nunca** toca no MongoDB. Persistir tokens,
  trava por conta, status de conexão e auditoria são do **serviço**. Por isso a renovação de token
  acontece *dentro* do adaptador (é uma chamada ao Mercado Livre), mas quem grava o par novo é o
  serviço, a partir do `updatedCredential` que o adaptador devolve.
- **Trava por conta cobre a operação inteira**, não só o refresh: enquanto uma publicação ou um
  encerramento roda numa conta, outra na mesma conta espera (até 15 s) e, se não conseguir, responde
  `409` "outra operação em andamento nesta conta". É mais simples que um lock só do refresh, funciona
  igual para Shopee/eBay depois, e cumpre a spec 2.3 (quem não obtém a trava espera e relê a
  credencial já renovada). Validade da trava: 120 s (uma publicação faz ~7 chamadas de 15 s no pior
  caso); uma trava órfã de um processo que caiu expira sozinha.
- **Persistir o par novo é condicional ao valor lido** (`replaceCredentialCiphertext`, o mesmo da
  rotação de chave). Se a conta foi desconectada no meio da operação, o valor mudou e o par novo é
  descartado — não ressuscita tokens de uma conta que o admin desconectou. Para a rotação de chave
  não roubar essa gravação, `rotateCredentialKey` passa a tentar a trava de cada conta e **pula**
  (`skippedConcurrent`, que já existe) a que estiver ocupada.
- **Criar × atualizar** é decidido pelo `id_anuncio` da entrada (spec 3.1), dentro do conector — o
  serviço só passa a entrada existente.
- **Falha de atualização não derruba um anúncio no ar**: entrada com `id_anuncio` que falha ao
  republicar continua `publicado`, com `erro` preenchido (spec 3.1). Só uma entrada **sem** id
  vira `erro`. Uma entrada `encerrado` cuja recriação falha continua `encerrado`, com `erro`.
- **Sem cache** de categoria/atributos: o volume é baixo e o Mercado Livre muda essas listas.
- **Modelo do vendedor** (spec 3.3): o payload de criação depende da tag `user_product_seller`
  (`family_name` × `title`), lida de `GET /users/me` a cada criação; o mapeador recebe o modelo como
  parâmetro e continua puro.
- **O SKU vai em `SELLER_SKU`** (não em `seller_custom_field`) e é a chave da busca de "resposta
  perdida" (spec 3.1).

## 3. Estrutura de arquivos

```
shared/schemas/
└── marketplace.schema.ts        # + status "encerrado", + encerrado_em (nullable, default null)
                                  #   → recompilar shared/dist (shared/AGENTS.md)

backend/src/
├── plugins/marketplaces/
│   ├── marketplace-connector.port.ts        # MUDA: publish(input) / close(input) → ConnectorOutcome<T>;
│   │                                        #   MarketplaceConnectorError { updatedCredential?, reconnectRequired }
│   ├── connector-registry.ts                # NOVO: conector por marketplace (+ seam de teste existente)
│   ├── mercado-livre-oauth.client.ts        # + refreshToken(); invalid_grant → reconnectRequired
│   ├── mercado-livre-api.client.ts          # NOVO: chamadas HTTP (categorias, items, descrição, busca por SKU, close)
│   ├── mercado-livre-item.mapper.ts         # NOVO: funções puras produto → payload de criação/atualização
│   ├── mercado-livre-package.config.ts      # NOVO: pacote padrão configurável (categoria > departamento > padrão)
│   └── mercado-livre.connector.ts           # NOVO: implementa a porta (criar/atualizar/encerrar + refresh)
├── repositories/
│   ├── marketplace-account.repository.ts    # + acquireOperationLease / releaseOperationLease
│   └── product.repository.ts                # + countPublishedListingsByAccount
├── schemas/
│   ├── audit-log.schema.ts                  # + PRODUCT_UNPUBLISH
│   └── marketplace-account.schema.ts        # + publishedListingsCount na resposta de conta
├── services/
│   ├── account-operation.service.ts         # NOVO: runAccountOperation (trava + credencial + persistência + expired)
│   ├── marketplace-listing.service.ts       # publishListing refatorado; + closeListing
│   ├── marketplace-account.service.ts       # respostas de conta trazem publishedListingsCount
│   └── credential-key-rotation.service.ts   # pula conta com trava ocupada
└── routes/marketplace-listing.routes.ts     # + POST /:id/marketplace-listings/close

frontend/src/
├── schemas/audit-log.schema.ts              # + PRODUCT_UNPUBLISH (o enum do frontend é uma cópia própria)
├── schemas/marketplace-account.schema.ts    # + publishedListingsCount
├── services/marketplace-listing.service.ts  # + closeListing
├── hooks/useMarketplaceListings.ts          # + useCloseListing
├── features/products/PublishToMarketplace.tsx        # Republicar / Encerrar anúncio / status encerrado / pendência
├── features/products/ActiveListingsNotice.tsx        # NOVO: aviso "peça com anúncio no ar" + Encerrar anúncios
├── pages/products/ProductsPage.tsx          # aviso antes de "Marcar como vendida" e "Desativar"
├── pages/products/ProductFormPage.tsx       # aviso ao salvar com status vendido/inativo
└── pages/admin/MarketplaceAccountsPage.tsx  # confirmações de Desconectar/Apagar mostram publishedListingsCount

e2e/
├── fake-mercado-livre.ts                    # NOVO: servidor HTTP falso da API do Mercado Livre
└── tests/marketplace-mercado-livre.spec.ts  # NOVO
```

## 4. Fluxo de execução (camadas)

### 4.1 Publicar / republicar

```
PublishToMarketplace → POST /api/products/:id/marketplace-listings   { marketplace, accountId }
  → routes (authenticate + authorize(["admin","operator"]))
  → marketplace-listing.service.publishListing
      → valida dados mínimos (011, 4.6) e conta ↔ marketplace
      → entrada existente = product.marketplaces[marketplace + conta_id]
      → account-operation.service.runAccountOperation(accountId, ctx => connector.publish(...))
          ├─ espera a trava da conta (15 s) → 409 se ocupada
          ├─ relê a conta e a credencial (já com o refresh de quem chegou antes)
          ├─ connector.publish({ product, listing: existente|null, account, credential })
          │     Mercado Livre — CRIAR (sem id_anuncio):  predictor → GET category → GET attributes
          │        → valida faixa de preço → [busca por SKU se retentativa] → POST /items → POST description
          │     Mercado Livre — ATUALIZAR (com id_anuncio, publicado): GET /items/{id}
          │        → GET category/attributes → PUT /items/{id} → PUT description
          │     (token: renova antes se expires_at < 5 min; 401 → renova e repete 1×)
          ├─ grava updatedCredential se houver — no sucesso E no erro (condicional ao valor lido)
          ├─ reconnectRequired → connectionStatus = "expired"
          └─ solta a trava (finally)
      → upsert da entrada (status/erro conforme a tabela da spec 3.1) + auditoria PRODUCT_PUBLISH
```

### 4.2 Encerrar

```
PublishToMarketplace → POST /api/products/:id/marketplace-listings/close   { marketplace, accountId }
  → routes (admin | operator)
  → marketplace-listing.service.closeListing
      → entrada existe e está "publicado"?         não → 409 (ListingNotPublishedError)
      → conta existe? (404) ativa? conectada?      não → 409 com o passo que falta, sem chamar o Mercado Livre
      → runAccountOperation → connector.close → PUT /items/{id} { status: "closed" } (409 de versão: espera e repete, até 3×)
      → sucesso: status = "encerrado" + encerrado_em;  falha: segue "publicado" + erro "Falha ao encerrar: …"
      → auditoria PRODUCT_UNPUBLISH (marketplace, accountId, id_anuncio, success, error?)
```

### 4.3 Aviso de anúncio no ar e contagem por conta

```
ProductsPage ("Marcar como vendida" / "Desativar") e ProductFormPage (salvar com status vendido/inativo)
  → se o produto tem entrada "publicado": ActiveListingsNotice
       [Encerrar anúncios e continuar]  [Continuar sem encerrar]  [Cancelar]
       (encerra uma a uma; se algum falhar, para, mostra o erro e NÃO muda o status da peça)

MarketplaceAccountsPage → GET /api/marketplace-accounts
  → marketplace-account.service → productRepository.countPublishedListingsByAccount() (um aggregate
    para todas as contas) → publishedListingsCount em cada resposta de conta
```

## 5. Passos de implementação

Cada fase termina com `lint` + `test` dos pacotes tocados. As tasks (`tasks.md`) detalham e
numeram; este plano fixa a ordem e as decisões.

### Fase 0 — Confirmações na documentação e no app (antes de codificar o adaptador)

A documentação do Mercado Livre respondeu 403 para leitura automática; as páginas foram então
salvas à mão em `DocumentacaoMercadoLivre/` (raiz do repositório) e lidas de lá. Os pontos abaixo
registram o que já foi confirmado e o que ainda falta; o resultado de cada um vai para a própria
spec e, se mudar algo, para os passos seguintes.

**Confirmado**

1. **Edição de anúncio com vendas** (spec 3.1) — ✅ ("Sincronização e modificação de publicações",
   24/03/2026): com vendas não muda o título, `buying_mode` nem meios de pagamento. Achado novo: desde
   18/03/2026, `PUT` só com `price` é rejeitado se há automatização de preços; com `price` + outros
   campos o preço é ignorado com um *warning*.
2. **SKU** (spec 3.1) — ✅ ("Busca de itens" e "Publicar produtos"): o SKU vai no atributo
   `SELLER_SKU` (não em `seller_custom_field`), e a busca é `GET /users/{user_id}/items/search?seller_sku=`
   (resposta só com ids + `paging`; multiget `GET /items?ids=…` com até 20). "Só ativos" é da busca
   pública, não desta.
3. **Encerrar** (spec 7) — ✅: `PUT /items/{id}` com `{"status":"closed"}`; estado final; o Mercado
   Livre descarta encerrados sozinho; excluir é um segundo `PUT` com `{"deleted":"true"}` (fora de
   escopo); sem erro documentado para "já encerrado" → idempotência por `GET`. `POST /items/{id}/relist`
   existe, mas só aceita `price`/`quantity`/`listing_type_id`.
4. **Categoria e criação** (spec 3, 3.3, 4) — ✅ ("Publicar produtos", "User Products", "Domínios e
   Categorias", "Categorização de produtos", "Atributos", "Descrição de produtos", "Validações"):
   - `GET /categories/{id}` → `settings.max_title_length`, `minimum_price`, `maximum_price` (pode ser
     `null`), `max_pictures_per_item`, `max_description_length`, `immediate_payment`, `listing_allowed`.
   - **Modelo *User Products*:** vendedores com a tag `user_product_seller` enviam `family_name` (não
     `title`, não `variations`); `family_name` ≤ `max_title_length`.
   - `condition` está sendo descontinuado → `attributes[ITEM_CONDITION]`.
   - Descrição: `POST` cria; `PUT ...?api_version=2` substitui; um `POST` sobre item com descrição
     responde `400`; texto plano, só `\n`, sem HTML/emoji.
   - Tags de atributo (`required`, `new_required`, `conditional_required` → `POST
     /categories/{id}/attributes/conditional`, `read_only`/`fixed`/`inferred`): spec 4.
   - Formato de erro `{ message, error, status, cause: [{ department, cause_id, type, code,
     references, message }] }`; `type: warning` não bloqueia.
5. **`sandbox_mode: true` do app** (spec 3.3) — ✅ ("Realização de testes"): o Mercado Livre **não
   tem sandbox**; testa-se com **usuários de teste** em produção (`POST /users/test_user`, até 10; caem
   após 60 dias sem atividade). Anúncio de teste: título "Item de Teste – Por favor, NÃO OFERTAR!",
   categoria "Outros", nunca `gold`/`gold_premium`; só se transaciona entre usuários de teste; contas
   pessoais ou de familiares **não** devem ser usadas em testes. Usuário de teste também precisa pedir
   a ambientação ao modelo *User Products* por formulário. A página não explica o `sandbox_mode: true`
   do app; sem ambiente sandbox, tratamos como sem efeito e confirmamos no primeiro teste.
6. **Tipo de anúncio** (spec 3.2) — informação reunida ("Tipos de publicação", "Custos por vender"):
   tipos do MLB, `available_listing_types`, `listing_prices` (custo por tipo, exige token). **A
   decisão** continua sendo da dona do brechó.

**Confirmado depois** (páginas "Tabelas de medidas" e "Identificadores de produtos")

7. **Moda** (spec 3.5) — ✅: em domínios com tabela de medidas (`GET /catalog/charts/MLB/configurations/
   active_domains`) o item leva `GENDER`, `SIZE`, `SIZE_GRID_ID` e `SIZE_GRID_ROW_ID`. A tabela se
   encontra com `POST /catalog/charts/search` (por domínio sem prefixo, `site_id`, `seller_id`, `GENDER`
   e `BRAND`), preferindo `BRAND`, depois `STANDARD`; a linha vem de `GET /catalog/charts/{id}` e o
   `SIZE` precisa ser idêntico ao da linha. Criar tabelas `SPECIFIC` (`POST /catalog/charts`) fica fora
   de escopo. Anúncios que descumprem as validações são moderados e pausados **depois**.
8. **`EMPTY_GTIN_REASON`** (spec 5) — ✅: lista fixa vinda de `GET /categories/{id}/attributes`
   (`Artesanal` 17055158, `Kit` 17055159, `No registrado` 17055160, `Otro` 17055161); enviamos `No
   registrado` (alternativa: `Otro`), só quando o GTIN é exigido (`required` ou `conditional_required`
   confirmado pelo endpoint condicional).

**Decidido e ainda aberto**

9. **Dimensões do pacote** (spec 3.4) — ✅ **decidido (ADR-027, 22/09/2026)**: pacote padrão **único**,
   editado numa tela de admin ("Contas de marketplace → Pacote padrão do Mercado Livre") e gravado no
   banco — não mais variável de ambiente, sem exceção por categoria/departamento; o peso vem do produto
   (kg → g, arredondado para cima), com o peso do pacote padrão (sempre obrigatório no formulário) como
   reserva. Sem pacote configurado, a publicação falha antes do `POST`. Os **valores reais** dependem
   das embalagens do brechó (T051) — preenchidos direto na tela.
10. **Tamanhos do ERP × tabelas de medidas** (spec 3.5) — ✅ **medido (T050, 21/09/2026)**: só calçados
    têm tabela `STANDARD` (5 domínios) ou `BRAND` (9); **nenhum domínio de roupa tem**. **Decisão (T053,
    ADR-024, 22/09/2026):** o ERP cria/estende tabelas `SPECIFIC` por API, com as medidas reais de cada
    peça — cada peça é única (constituição, princípio X), então a medida real já é o que a tabela precisa.
    Exige estender `medidas` (`coxa`, `entrepasso` — T056; confirmado só para calças/shorts/saias, partes
    de cima dependem de `technical_specs` na implementação). No ERP de dev, 7 de 9 produtos não têm
    `tamanho_etiqueta`, e o `SIZE` é obrigatório. Também **decisão (T054, ADR-025, 22/09/2026):** o
    preditor devolveu domínios inesperados para peças comuns ("camisa masculina" →
    `MLB-RUGBY_JERSEYS`, "jaqueta masculina" → `MLB-FOOTBALL_JACKETS`) — revisão humana **obrigatória
    em toda publicação** (criar, republicar, recriar), com o preditor só sugerindo e o operador
    confirmando/corrigindo numa lista curada de categorias de Roupas/Calçados/Bolsas; sem mapeamento
    configurável (rejeitado — a revisão sempre presente já cobre o risco que ele cobriria).
11. **Domínio ativo = tabela obrigatória?** (spec 3.5) — ⚠ a documentação não diz que toda a lista de
    `active_domains` é obrigatória; tratamos como obrigatória (lado seguro).
12. **Texto exato do *warning* de preço ignorado** (spec 3.1) — não documentado; confirma-se na Fase 8.
Forma de confirmar sem publicar de verdade: `GET /categories/...`, `GET /sites/MLB/listing_types` e
`GET /items/{id}` (de um anúncio existente) são leituras. Publicar, republicar e encerrar são
verificados na Fase 8 com um **usuário de teste**.

### Fase 1 — Contrato compartilhado, auditoria e contagem

1. `shared/schemas/marketplace.schema.ts`: `encerrado` em `MarketplaceListingStatusEnum` e
   `encerrado_em` (`z.coerce.date().nullable().default(null)` — documentos antigos não têm o campo).
   `npm run build` em `shared/`.
2. `PRODUCT_UNPUBLISH` no `AuditActionEnum` do backend **e** no do frontend (cópia própria, com
   rótulo "Anúncio encerrado" em `AuditLogsPage`) — a omissão dessa cópia já quebrou a tela de
   Auditoria uma vez (ações `MARKETPLACE_*`), então um teste de contrato (seção 6) compara os dois enums.
3. `productRepository.countPublishedListingsByAccount(db)`: `aggregate` com `$unwind` de
   `marketplaces`, `$match` em `status = "publicado"`, `$group` por `conta_id` → `Map<string, number>`.
   Conta **todos** os produtos, inclusive vendidos/inativos (são exatamente os que precisam ser encerrados).
4. `publishedListingsCount` no schema de resposta de conta (backend e frontend); o serviço de conta
   o preenche em **todas** as respostas (listar, obter, criar, editar, ativar/desativar,
   desconectar, conectar) por um único helper.

### Fase 2 — Porta, registro de conectores e migração dos dublês

1. `marketplace-connector.port.ts`: `publish({ product, listing, account, credential })`,
   `close({ listing, account, credential })`, ambos → `ConnectorOutcome<T> = { value: T; updatedCredential?: string }`;
   `PublishResult = { id_anuncio, url_anuncio, pendencia: string | null }`;
   `MarketplaceConnectorError extends Error { updatedCredential?: string; reconnectRequired: boolean }`.
2. `connector-registry.ts`: `getConnector(marketplace)` — o override de teste
   (`setMarketplaceConnectorForTesting`, mantido) vale para qualquer marketplace; sem override,
   usa o registro (`mercado_livre` → conector desta spec); marketplace sem conector →
   erro claro "Nenhum conector configurado para X" (comportamento atual preservado).
3. Migrar os dublês de `marketplace-listing.service.test.ts` e `marketplace-listings.spec.ts` para o
   contrato novo, sem mudar o que eles afirmam.

### Fase 3 — Trava por conta e persistência de credencial

1. `marketplaceAccountRepository.acquireOperationLease(db, id, owner, ttlMs)` — `findOneAndUpdate`
   condicionado a "sem trava ou trava vencida", grava `operationLeaseOwner`/`operationLeaseExpiresAt`
   (campos internos, nunca expostos); `releaseOperationLease(db, id, owner)` só libera se o dono
   for o mesmo.
2. `account-operation.service.ts` — `runAccountOperation(accountId, op)`: espera a trava (poll de
   250 ms, até 15 s; senão `AccountBusyError` → `409`), relê a conta, decifra, roda `op`, e no `finally`
   persiste `updatedCredential` (condicional ao ciphertext lido), aplica `reconnectRequired →
   expired` e solta a trava. Nunca loga credencial.
3. `credential-key-rotation.service.ts`: tenta a trava por conta; ocupada → conta em
   `skippedConcurrent`.

### Fase 4 — Adaptador do Mercado Livre

1. `mercado-livre-oauth.client.ts`: `refreshToken({ clientId, clientSecret, refreshToken })`
   (`grant_type=refresh_token`); `invalid_grant` → `MercadoLivreOAuthError` com `reconnectRequired`;
   erro de rede/5xx sem esse flag. Interface `MercadoLivreOAuthClient` ganha o método (os fakes de
   teste são atualizados).
2. `mercado-livre-api.client.ts`: uma função por chamada (spec 3–7), todas com `Authorization:
   Bearer`, timeout de 15 s, resposta validada por Zod, erro classificado
   (`MercadoLivreApiError { status, code, causes }` — lê `cause[]` no formato da spec 3.6; mensagem
   sem token, sem `client_secret`). Chamadas: `GET /users/me` (tag `user_product_seller`), predictor,
   `GET /categories/{id}`, `GET /categories/{id}/attributes`, `POST /categories/{id}/attributes/
   conditional`, `GET /categories/{id}/sale_terms`, `POST`/`PUT /items`, `GET /items/{id}`, multiget
   `GET /items?ids=…`, `POST`/`PUT /items/{id}/description[?api_version=2]`, busca por SKU
   (`?seller_sku=`), `PUT` com `status: closed` e, para moda, `GET /catalog/charts/MLB/
   configurations/active_domains`, `GET /domains/{id}/technical_specs`, `POST /catalog/charts/search` e
   `GET /catalog/charts/{id}`. 429 e 5xx → mensagem "tente de novo em instantes", sem repetição
   automática; **única** repetição automática: `409` de versão no `close` (espera e repete até 3×).
3. `mercado-livre-item.mapper.ts` — funções **puras** (as mais testáveis do módulo):
   `buildCreatePayload` (com `family_name` ou `title` conforme o modelo do vendedor),
   `buildUpdatePayload`, `mapCondition` (`novo → "Novo"`; `seminovo`/`usado → "Usado"`, com o
   `value_id` vindo dos atributos da categoria — **atributo** `ITEM_CONDITION`, nunca `condition`),
   `pickAttributes` (só o que a categoria aceita; nunca `read_only`/`fixed`/`inferred`),
   `skuAttribute` (`SELLER_SKU`), `packageAttributes` (`SELLER_PACKAGE_*`: inteiros, cm e g; peso kg →
   g arredondado para cima), `gtinAttribute` (`EMPTY_GTIN_REASON` com o `value_id` da categoria, só
   quando o GTIN é exigido — `required`, ou `conditional_required` confirmado pelo endpoint
   condicional), `genderAttribute` (departamento da categoria → valor de `GENDER`), `sizeChartAttributes`
   (`SIZE`, `SIZE_GRID_ID`, `SIZE_GRID_ROW_ID`) e `pickChartRow` (linha cujo `SIZE` é igual a
   `tamanho_etiqueta`, senão a `tamanho_equivalente`; preferência `BRAND` > `STANDARD` > `SPECIFIC`),
   `truncateName` (`max_title_length`), `capPictures` (`max_pictures_per_item`, capa primeiro),
   `sanitizePlainText` (só `\n`; sem HTML/emoji; `max_description_length`), `immediateTag`
   (`immediate_payment` se a categoria exigir), `assertPriceInRange` (falha **antes** de qualquer
   `POST`/`PUT`), `warranty` (sem garantia; `usado`/`seminovo` nunca vira "Recondicionado"). As dimensões vêm de `resolvePackage` (pacote padrão configurável, spec 3.4 — T052).
4. `mercado-livre.connector.ts` — implementa a porta:
   - **token**: lê a credencial (`parseMercadoLivreCredential`); sem `access_token`/`refresh_token` →
     erro "conta não conectada" (`reconnectRequired`); `expires_at` a menos de 5 min → `refreshToken()`
     e devolve o par novo em `updatedCredential`; um `401` da API → renova e repete a chamada 1×.
   - **modelo do vendedor**: `GET /users/me` → tag `user_product_seller` decide `family_name` × `title`.
   - **criar**: predictor (`q` = nome do produto) → `GET /categories/{id}` (exige `listing_allowed` e
     `status = enabled`) → atributos (+ endpoint condicional para o GTIN) → **se o domínio está em
     `active_domains`: procura a tabela de medidas e a linha (spec 3.5); sem tabela/linha, falha antes
     do `POST`** → valida faixa de preço → `POST /items` → `POST` da descrição; descrição que falha →
     `PublishResult.pendencia` (item não é desfeito); retentativa de entrada `erro` sem id →
     `GET /users/{user_id}/items/search?seller_sku=` + multiget dos ids e adota o mais recente que
     **não** esteja `closed` (spec 3.1).
   - **atualizar**: `GET /items/{id}` primeiro (status, `sold_quantity`, categoria); `family_name`
     (ou título, no modelo antigo) só se `sold_quantity = 0`; `pictures` **sempre** no `PUT`;
     descrição por `PUT ...?api_version=2` com queda para `POST` se o item não tem descrição;
     `warnings` da resposta (preço ignorado) viram `pendencia`; item já `closed` no Mercado Livre →
     erro que orienta a usar "Encerrar anúncio".
   - **encerrar**: `GET /items/{id}` antes — `status = closed` → sucesso sem `PUT`; senão `PUT {
     status: "closed" }`; `409` repetido antes de falhar; item `under_review`/`payment_required` que
     recuse `closed` → mensagem do Mercado Livre ao operador.
   - Todo erro é lançado como `MarketplaceConnectorError` **carregando o `updatedCredential`** se houve
     renovação antes da falha.
5. `MERCADO_LIVRE_API_BASE_URL` lida na criação do conector, documentada em `.env.example`. Pacote
   padrão e tipo de anúncio **não** são variáveis de ambiente: o pacote vem do banco
   (`mercado-livre-package.config.ts` lê `mercadoLivrePackageSettingsRepository`, ADR-027) e o tipo de
   anúncio (`listingTypeId`) vem da revisão do operador (ADR-026, T059).

### Fase 5 — Serviços e rotas de anúncio

1. `publishListing` refatorado sobre `runAccountOperation` e a porta nova, aplicando a tabela de
   transições da spec 3.1 (criar / atualizar / recriar; falha parcial; falha de atualização que
   mantém `publicado`); `publicado_em` é atualizado a cada publicação/atualização bem-sucedida.
2. `closeListing` (seção 4.2) com `ListingNotPublishedError` e `AccountNotReadyError` (ambos `409`,
   mensagem com o passo que resolve), reaproveitando `AccountBusyError`.
3. `POST /api/products/:id/marketplace-listings/close` (`admin`/`operator`), corpo
   `{ marketplace, accountId }` validado por Zod; mapeia 404/409/400 como as rotas vizinhas.

### Fase 6 — Frontend

1. `PublishToMarketplace`: badge "Encerrado"; "Ver anúncio" só em `publicado`; entrada
   `publicado` com `erro` mostra o aviso de pendência; o botão principal vira **"Republicar no
   Mercado Livre"** quando a conta escolhida já tem entrada `publicado`; **"Encerrar anúncio"**
   por linha, com confirmação inline (texto da spec 011, 4.7) e o erro da API visível.
2. `ActiveListingsNotice` + integração em `ProductsPage` (ações "Marcar como vendida" e
   "Desativar") e `ProductFormPage` (ao salvar mudando para `vendido`/`inativo`). Encerra em
   sequência; falha interrompe e mantém o status da peça.
3. `MarketplaceAccountsPage`: coluna "Anúncios no ar" e `publishedListingsCount` no texto da
   confirmação de **Desconectar** e de **Apagar** (só avisa, não bloqueia — ADR-022, adendo).

### Fase 7 — E2E com servidor falso

`e2e/fake-mercado-livre.ts` (HTTP em porta local, respostas roteirizáveis por teste) e o backend do
`webServer` do Playwright com `MERCADO_LIVRE_API_BASE_URL` apontando para ele. O OAuth de navegador
(`auth.mercadolivre.com.br`) **não** é automatizável; o teste cria a conta e grava a credencial já
com tokens direto no banco de teste (helper de `global-setup`).

### Fase 8 — Verificação manual contra o Mercado Livre real

O Mercado Livre **não tem sandbox** e manda testar com **usuários de teste** (Fase 0, item 5). Sequência:

1. Com o token da conta real, criar um usuário de teste vendedor (`POST /users/test_user`,
   `{"site_id":"MLB"}`); **guardar** o apelido e a senha na hora (a API não os mostra depois). Pedir a
   ambientação do usuário de teste ao modelo *User Products* pelo formulário da documentação (ativação
   a cada 7 dias) — sem isso o teste exercita o modelo antigo (`title`).
2. Cadastrar uma conta do Mercado Livre no ERP com o Client ID/Secret do app e conectá-la por OAuth
   **logando como o usuário de teste**.
3. Publicar uma peça de teste — título "Item de Teste – Por favor, NÃO OFERTAR!", categoria "Outros" e,
   na revisão, um tipo de anúncio diferente de `gold`/`gold_premium` (ADR-026) — → conferir o anúncio →
   republicar (mudando o preço) → **encerrar**. Aqui se confirma o formato do *warning* de preço, o corpo do
   encerramento e as dimensões do pacote.
4. Só depois, a **primeira publicação real** (uma peça de verdade, na conta da loja, com o tipo de anúncio
   decidido pela dona do brechó) — isso não é teste, é uso.

## 6. Testes planejados

- **Unitário**
  - *Mapper* (tabela): condição, GTIN vazio, garantia, atributos que a categoria não tem, título
    truncado, preço fora da faixa (sem chamar a API), `available_quantity = 1`.
  - *Cliente de API* (`fetch` simulado): cabeçalho `Bearer`, classificação de erro, mensagens sem
    token/segredo, `409` repetido com relógio falso, 429/5xx sem repetição.
  - *Conector* (API/OAuth falsos): criar × atualizar × recriar; descrição falha → `pendencia`;
    retentativa sem id adota o anúncio por SKU; refresh quando `expires_at` está perto;
    `updatedCredential` presente **mesmo quando a operação falha depois**; `invalid_grant` →
    `reconnectRequired`; erro de rede não; encerrar idempotente.
  - *Trava/serviço* (MongoDB em memória): duas operações na mesma conta rodam em série; trava
    vencida é retomada; ocupada além de 15 s → `409`; rotação pula conta ocupada; par novo é
    descartado se a conta foi desconectada durante a operação; `expired` só por `invalid_grant`.
  - *Serviço de anúncio*: cada linha da tabela de transições da spec 3.1; `closeListing` rejeita
    entrada não `publicado` e conta inativa/desconectada sem chamar o conector.
- **Integração** (Fastify + MongoDB em memória, **conector real** com API/OAuth falsos): fluxo
  publicar → republicar → encerrar → publicar de novo (id novo); `viewer` recebe `403` em publicar e
  encerrar; `409` fora de ordem; auditoria `PRODUCT_PUBLISH`/`PRODUCT_UNPUBLISH` sem credencial;
  `publishedListingsCount` correto por conta (inclui produto vendido); desativar/desconectar/apagar
  conta com anúncio no ar continua permitido e avisa; contrato dos enums de auditoria backend ×
  frontend (falha se um lado tiver ação que o outro não conhece).
- **E2E** (Fase 7): publicar, republicar e encerrar pela tela; aviso ao marcar como vendida com
  anúncio no ar (encerrar e continuar / continuar sem encerrar / cancelar); confirmação de
  Desconectar mostrando "N anúncio(s) no ar".

## 7. Riscos / decisões em aberto

- **Roupas exigem tabela `SPECIFIC` criada pelo próprio ERP** (T050/T053, ADR-024): nenhum domínio de
  roupa tem tabela `STANDARD`/`BRAND`. A implementação (T023/T025) cria/estende a tabela com as medidas
  reais da peça (`medidas`, T056), o que é mais escopo do que só ler uma tabela pronta — inclui criar a
  tabela na primeira peça de cada domínio+gênero e decidir, a cada peça seguinte, se a combinação
  tamanho+medidas já existe (reaproveita linha) ou não (adiciona linha nova). Somam-se: o
  `tamanho_etiqueta` e as medidas do domínio são obrigatórios (7 de 9 produtos de dev não têm
  `tamanho_etiqueta`, e nenhum tem `coxa`/`entrepasso` ainda) e a categoria confirmada na revisão
  (T054, ADR-025) decide o domínio, que decide quais medidas são pedidas. Partes de cima (camisas, blusas, jaquetas, vestidos) têm os
  atributos `GARMENT_*` **não confirmados** — só se sabe ao consultar `technical_specs` na implementação;
  se pedirem medida que o ERP não captura, vira uma extensão nova de `medidas`, decidida então. O
  **pacote padrão** também precisa de valores reais (T051) — pacote errado não bloqueia a publicação, mas
  pode cobrar frete a mais ou a menos.
- **Pacote padrão é uma aproximação**: toda peça, de qualquer categoria, usa o mesmo pacote único
  (ADR-027). Aceito na v1; a saída é uma exceção por categoria (se o uso real mostrar necessidade)
  ou, depois, dimensões por produto (spec 005) — a tela de administração da configuração em si já
  existe desde a ADR-027.
- **Moderação posterior:** um anúncio de moda criado que descumpra a validação da tabela é pausado
  depois; o ERP mostra `publicado` mesmo assim (sem sincronização de status). Fica como evolução
  natural junto do resto da sincronização.
- **Modelo *User Products***: a criação usa `family_name`; usuários de teste precisam pedir a
  ambientação por formulário (ativação a cada 7 dias) — planejar o pedido cedo, ele atrasa a Fase 8.
- **Anúncios de moda usados fecham sozinhos ao vender**: o ERP não sabe (sincronização fora de escopo);
  a entrada continua `publicado`. O "Encerrar" idempotente e a orientação ao marcar como vendida
  cobrem o caso; uma sincronização de status é a evolução natural.
- **Renovação do Client Secret no app**: o Mercado Livre permite renovar (agora, ou programada em até 7
  dias) e a chave anterior expira. Depois de renovar, é preciso **editar a conta no ERP** com o novo
  Client Secret (o que a desconecta) e reconectá-la; sem isso a renovação de token falha com
  `invalid_client`.
- **Formato do *warning* de preço** (spec 3.1): a documentação diz só que a resposta "retornará um
  warning"; as respostas de item têm `warnings` e cada aviso carrega `cause_id`, `type`, `code` e
  `message`, mas o texto do aviso de preço não está documentado. O conector lê `warnings` de forma
  defensiva (qualquer aviso vira pendência) e a Fase 8 confirma o formato real.
- **Limite de requisições**: os metadados do app mostram `max_requests_per_hour: 18000` — folga larga
  para o volume do brechó; 429 continua sem repetição automática.
- **Documentação salva em `DocumentacaoMercadoLivre/`**: são páginas HTML do portal (~20 MB, conteúdo
  com direitos do Mercado Livre); avaliar mantê-las **fora do git** (`.gitignore`) e citar só as
  conclusões nas specs — como está feito.
- **Testes reais só com usuário de teste**: a documentação proíbe usar contas pessoais ou de familiares
  em testes; o anúncio de teste tem título e categoria prescritos (Fase 8). O custo do `gold_special`
  incide sobre venda, não sobre publicação.
- **Trava órfã**: um processo que cai no meio de uma operação segura a trava por até 120 s; depois
  expira. Aceito. Em ambiente com várias réplicas a trava em MongoDB continua correta.
- **Refresh perdido**: se a gravação do par novo falhar (banco fora do ar) depois de o Mercado Livre
  já ter gasto o `refresh_token`, a conta fica `expired` e precisa de reconexão. É o custo de o
  token ser de uso único; a mensagem de reconexão já cobre.
- **Custo da contagem por conta**: `countPublishedListingsByAccount` varre `products` a cada
  listagem de contas. Volume do brechó não justifica índice; se `products` crescer, índice em
  `marketplaces.conta_id` + `marketplaces.status`.
- **Anúncio encerrado por fora** (o Mercado Livre fecha sozinho ao vender, ou o admin encerrou no
  painel): o ERP não sabe (sincronização fora de escopo). Republicar nesse caso responde com o
  erro que orienta usar "Encerrar anúncio" — que é idempotente e alinha o ERP.
- **`listing_type_id`** é decisão de negócio pendente (Fase 0, item 6); o padrão `gold_special` é
  provisório.
- **Atualizar as specs/planos de 011** ao implementar: a assinatura da porta (011, plan seção 5,
  passo 2) e o `MarketplaceListingSchema` mudam; registrar nas `tasks.md` de 011 (nova fase) em vez
  de reescrever o histórico do plano.
- **`MERCADO_LIVRE_API_BASE_URL`** existe só para testes E2E; produção não deve defini-la (um valor
  errado desviaria as chamadas com token para outro host). O adaptador só aceita a variável fora de
  `NODE_ENV=production`.
