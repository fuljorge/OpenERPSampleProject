# Spec 012 — Conector Mercado Livre

**Domínio:** Marketplace Integration — Mercado Livre Connector
**Fase:** 3 — Marketplaces
**Status:** Draft
**Depende de:** [001-autenticacao](../001-autenticacao/spec.md),
[002-usuarios](../002-usuarios/spec.md),
[005-produtos-cadastro-manual](../005-produtos-cadastro-manual/spec.md),
[008-auditoria](../008-auditoria/spec.md),
[011-integracao-marketplaces](../011-integracao-marketplaces/spec.md)

## 1. Visão geral

Primeiro conector real de marketplace (011, seção 5 — roadmap de implementação: Mercado Livre
é o primeiro), implementando a porta `MarketplaceConnectorPort` (011, seção 4.1) contra a API
REST pública do Mercado Livre (`https://api.mercadolibre.com`): `publish` — **criar** o anúncio
ou **atualizá-lo** se já existir (seção 3.1) — e `close` — **encerrar** o anúncio (seção 7).

Fonte: documentação oficial do desenvolvedor
(`https://developers.mercadolivre.com.br/pt_br/guia-para-produtos` e páginas ligadas —
Autenticação e Autorização, Publicar produtos, Categorização de produtos, Descrição de
produtos, Imagens, Identificadores de produtos, Validações, User Products), levantada e
mapeada contra o modelo de produto do ERP (005, seção 2) como parte desta spec.

Esta spec cobre só o Mercado Livre. Shopee e eBay (011, seção 5) seguem o mesmo roadmap, cada
um em sua própria spec (013+), reaproveitando a porta comum e a infraestrutura de contas já
implementadas em 011 — nenhuma delas é antecipada aqui.

## 2. Autenticação (OAuth 2.0, Authorization Code)

O Mercado Livre não usa uma API key simples — exige o fluxo **OAuth 2.0 Authorization Code**
(*server side*):

```
GET  https://auth.mercadolivre.com.br/authorization
     ?response_type=code&client_id=$APP_ID&redirect_uri=$URL&code_challenge=...
     → operador loga no Mercado Livre e autoriza o app → redirect com ?code=...

POST https://api.mercadolibre.com/oauth/token   (grant_type=authorization_code)
     → { access_token, refresh_token, expires_in: 21600, user_id }

POST https://api.mercadolibre.com/oauth/token   (grant_type=refresh_token)
     → novo access_token + novo refresh_token (o anterior passa a ser inválido)
```

- `access_token` expira em **6 horas** (`expires_in: 21600`).
- `refresh_token` é de **uso único** — cada renovação retorna um novo, que substitui o
  anterior — e expira após **6 meses sem uso**.
- `client_id`/`client_secret` são do **aplicativo** cadastrado pelo dono do brechó no
  Mercado Livre — necessários tanto para trocar o `code` por token quanto para **renovar** o
  token a cada 6h. `access_token`/`refresh_token` são da conta (loja) que autorizou o app.

### 2.1 Impacto no modelo de credencial (extensão de 011, seção 2.1/3)

O campo `marketplace_accounts.credential` (011: "um único texto opaco") passa, para este
conector, a guardar um **JSON serializado como um único blob** — ainda criptografado como
valor único (011, seção 3, nenhuma mudança na estratégia de criptografia), só o *conteúdo*
muda:

```json
{
  "client_id": "1620218256833906",
  "client_secret": "...",
  "access_token": "APP_USR-...",
  "refresh_token": "TG-...",
  "expires_at": "2026-09-18T16:00:00-03:00"
}
```

`client_id`/`client_secret` **vivem na própria conta**, criptografados junto dos tokens (e não
em variáveis de ambiente): assim o admin informa tudo na tela de "Contas de marketplace" (011,
seção 2.2.1), sem depender de configuração de deploy, e cada loja pode usar seu próprio
aplicativo do Mercado Livre — necessário quando as contas pertencem a donos de app diferentes.
Como o par de tokens, nunca é exibido de volta (011, seção 3).

### 2.2 Cadastro de conta — desvio do fluxo genérico de 011, seção 2.2

A tela "Contas de marketplace" (011) assume que o admin **digita** uma credencial em texto
livre. Para Mercado Livre, a credencial não é digitável — é obtida redirecionando o admin para
a URL de autorização do Mercado Livre e capturando o `code` de retorno. O cadastro de uma
conta Mercado Livre segue, portanto:

```
Admin informa Client ID, Client Secret e o **usuário do Mercado Livre** da conta (seção 2.5) — access/refresh token NUNCA são digitados —
clica em "Testar integração" (seção 2.4) e, com o teste OK, em "Criar e conectar ao Mercado Livre"
        ↓
Backend cria a conta (connectionStatus = "disconnected"; credential = {client_id, client_secret})
        ↓
Backend gera um `state` aleatório de uso único (32 bytes, validade de 10 min, guardado na conta)
e devolve a URL de autorização; o frontend redireciona o admin
        ↓
Admin loga no Mercado Livre e autoriza o aplicativo
        ↓
Mercado Livre redireciona para o redirect URI com ?code=...&state=...
(página do próprio ERP: `<FRONTEND_URL>/admin/marketplace-accounts/oauth/callback`)
        ↓
A página envia {code, state} ao backend, que consome o `state` (atômico, antes de qualquer
chamada externa) e troca o code por access_token/refresh_token usando o Client ID/Secret da conta
        ↓
Backend confere o usuário autorizado com o esperado (seção 2.5), acrescenta os tokens ao JSON da
seção 2.1, criptografa (011, seção 3) e marca connectionStatus = "connected"
```

Pontos de projeto:

- **Redirect URI** = `FRONTEND_URL` + `/admin/marketplace-accounts/oauth/callback`. Precisa ser
  cadastrado, exatamente assim, como URL de redirecionamento no aplicativo do Mercado Livre
  (em produção também — `FRONTEND_URL` de produção). A tela mostra a URL a cadastrar.
- A troca do code acontece **no backend**: o navegador nunca vê `client_secret` nem tokens.
- `state` inválido, expirado ou já usado → 400 sem chamar o Mercado Livre; ele é consumido mesmo
  se a troca falhar (uso único).
- **Reconectar**: botão "Conectar/Reconectar" na lista repete o fluxo para a mesma conta (conta
  `disconnected`, ou com `refresh_token` expirado — seção 2.3). Trocar Client ID/Secret de uma
  conta a desconecta e descarta os tokens antigos (eram de outro aplicativo).
- **PKCE (S256) é sempre usado**, com o aplicativo do Mercado Livre com PKCE ligado ou não: no
  "Conectar" o backend gera um `code_verifier` aleatório (32 bytes, base64url), guarda-o na conta
  junto do `state` (mesma validade de 10 min, uso único, apagado no mesmo passo atômico) e envia só
  o `code_challenge = base64url(SHA-256(verifier))` com `code_challenge_method=S256` na URL de
  autorização; na troca do `code` envia o `code_verifier`. Necessário porque um aplicativo com PKCE
  ligado (`use_pkce: true`) recusa a autorização sem `code_challenge` — a tela genérica "não foi
  possível conectar o aplicativo". O verifier nunca vai para o navegador nem para a API.

Isso não substitui o modelo de dados de 011 (`marketplace_accounts`, seção 2.1) — só a forma
como `credential`/`connectionStatus` são preenchidos, específica deste conector.

### 2.3 Renovação do token

Renovado **sob demanda**, checando `expires_at` imediatamente antes de cada chamada
`publish(...)` — não um worker/job periódico (constituição, princípio V: sem infraestrutura
nova sem necessidade concreta). Vale para toda operação que fala com o Mercado Livre em nome
da conta — publicar, atualizar e encerrar. Se o `refresh_token` também tiver expirado (6 meses
sem uso), a operação falha com `status = erro` e mensagem clara pedindo para reconectar a conta
(seção 2.2) — `connectionStatus` passa a `expired` (011, seção 2.1).

Como o `refresh_token` é de **uso único** (seção 2), perder o par novo deixaria a conta
permanentemente `expired`. A renovação tem, por isso, regras próprias:

- **Persistir sempre.** Toda renovação devolve à camada de serviço o par novo (`access_token`,
  `refresh_token`, `expires_at`), e o serviço o grava (cifrado, 011, seção 3) **antes** de seguir
  para a chamada de negócio — e também quando essa chamada falha depois. Por isso a porta (011,
  seção 4.1) devolve `updatedCredential` junto do resultado **e** do erro; o adaptador nunca
  guarda estado por conta. O formato exato do contrato cabe ao plan.md.
- **Uma renovação por vez, por conta.** Duas operações simultâneas na mesma conta (duas
  publicações, ou publicar e encerrar) não podem gastar o mesmo `refresh_token`. A renovação é
  serializada por conta com uma trava atômica no documento da conta, de validade curta; quem não
  obtém a trava espera, relê a credencial já renovada e a usa. A gravação do par novo é
  condicional ao valor lido — o mesmo mecanismo da rotação de chave (011, seção 3.1).
- **Falha na renovação.** `invalid_grant` (refresh_token expirado ou já gasto) →
  `connectionStatus = expired`. Erro de rede ou 5xx do Mercado Livre é transitório e **não**
  muda o status: a operação falha com `erro` e pode ser retentada.

### 2.4 Teste de integração no cadastro

Antes de criar a conta, o formulário tem o botão **"Testar integração"**; o botão "Criar e
conectar ao Mercado Livre" só é liberado depois que o teste passar.

```
POST /api/marketplace-accounts/mercado-livre/test-connection   { client_id, client_secret }   (admin)
   backend → POST https://api.mercadolibre.com/oauth/token   (grant_type=client_credentials)
   backend → GET  https://api.mercadolibre.com/users/me      (Authorization: Bearer <token do app>)
   200 → { userId, nickname }        400 → mensagem acionável (sem client_secret nem token)
```

- No cadastro ainda não existe access token de usuário (ele nasce do OAuth, seção 2.2), então o
  teste usa o **token do próprio aplicativo** (`client_credentials`). Passa só se o Mercado Livre
  aceitar o par Client ID/Secret **e** responder 200 em `GET /users/me`.
- Não grava nada e não chama nada além dessas duas requisições; rate limit de 10/min por ser
  admin-only e falar com um terceiro.
- O resultado vale só para o par testado: editar Client ID ou Client Secret invalida o teste e
  bloqueia o botão de criar de novo. A garantia é de interface — o backend continua aceitando
  `POST /api/marketplace-accounts` sem teste (o OAuth da seção 2.2 é a validação definitiva).

### 2.5 Usuário do Mercado Livre da conta

O cadastro pede **qual usuário do Mercado Livre a conta vai usar** — o apelido (ex.: `OpenErpSampleSalesML`)
ou o ID numérico — e o ERP **confere** isso depois do OAuth. Motivo: quem autoriza o aplicativo é o usuário
que estiver logado no Mercado Livre naquele navegador; sem conferência, é fácil conectar o usuário errado (um
usuário de teste no lugar da loja, ou uma conta pessoal).

- **Campo `expectedUser`** (texto, não é segredo): obrigatório na tela para contas **novas** do Mercado
  Livre. A API o aceita ausente — contas anteriores a esta regra não o têm; nesse caso a conexão não é
  conferida e a tela mostra "não informado".
- **Conferência ao completar o OAuth** (seção 2.2): depois de trocar o `code`, o backend chama `GET
  /users/me` com o token novo. Se `expectedUser` tiver só dígitos, compara com o `id`; senão, com o
  `nickname`, sem diferenciar maiúsculas de minúsculas (um `@` inicial é ignorado). **Divergiu → `400`**:
  nada é gravado (os tokens são descartados) e a mensagem diz quem autorizou e quem era esperado ("O
  Mercado Livre autorizou o usuário X (ID N), mas esta conta está configurada para Y. Saia do Mercado
  Livre e conecte de novo com o usuário correto.").
- **Identidade conectada:** ao conectar, o ERP guarda `connectedUserId` e `connectedNickname` (não são
  segredo; aparecem na tela e a auditoria registra `mlUserId`). Desconectar limpa os dois.
- **Editar** o `expectedUser` de uma conta muda a identidade esperada: a conta é **desconectada** (mesmo
  tratamento de trocar o Client ID/Secret) e precisa ser reconectada.
- A lista de contas mostra o usuário: o apelido conectado ou, enquanto desconectada, o esperado.
- Vale também para o **usuário de teste** (`TESTUSER…`): informa-se o apelido dele, e a conferência
  impede confundi-lo com a conta de produção.

## 3. Mapeamento de campos — produto do ERP → `POST /items`

| Campo do ERP (005, seção 2) | Campo do Mercado Livre | Regra de conversão |
|---|---|---|
| `identificacao.nome` | `family_name` (modelo *User Products*) ou `title` (modelo antigo) | Seção 3.3. No modelo novo o `title` **não** é enviado — o Mercado Livre o monta. Limitado a `settings.max_title_length` da categoria (seção 4). |
| `classificacao.categoria_codigo` | `category_id` | **Não é 1:1** — ver seção 4 (preditor de categorias). |
| `preco.preco_venda` | `price` + `currency_id="BRL"` | Bloqueado antes de publicar se fora de `settings.minimum_price`/`maximum_price` da categoria (seção 6). |
| `condicao.estado` | `attributes[ITEM_CONDITION]` | `novo` → `"Novo"`; `seminovo` e `usado` → `"Usado"` (o Mercado Livre não distingue seminovo). O `value_id` vem de `GET /categories/$CATEGORY_ID/attributes`, nunca fixado aqui. O campo `condition` está sendo descontinuado pelo Mercado Livre — não é enviado. |
| `estoque.quantidade` | `available_quantity` | Sempre `1` — peça única, sem variações (constituição, princípio X; 011, seção 7). A documentação lista categorias que limitam itens usados a 1 unidade só para MLA, MLM, MLC e MPE; o Brasil (MLB) não consta, e de qualquer forma enviamos sempre 1. |
| `imagens.galeria[].url` | `pictures: [{ "source": url }]` | URL direta — nosso Azure Blob Storage já é de leitura pública (ADR-003), então **não** usamos o endpoint de upload binário do Mercado Livre. No máximo `settings.max_pictures_per_item` fotos (a categoria define; ex.: 12), capa primeiro. `gold_special`/`gold_pro` exigem ao menos uma foto, e o Mercado Livre recusa foto com menos de 500 px no maior lado (`item.pictures.invalid_size`). |
| `identificacao.descricao` | `POST /items/$ITEM_ID/description` (criar) ou `PUT /items/$ITEM_ID/description?api_version=2` (substituir), corpo `{ "plain_text": … }` | Chamada **separada**, depois de o item existir — nunca no payload de criação. Texto plano: só `\n` como quebra de linha; sem HTML, negrito nem emoji (o erro `item.description.type.invalid` informa a posição do caractere); até `settings.max_description_length` (ex.: 50000). Um `POST` sobre item que já tem descrição responde `400`. |
| `caracteristicas.marca_nome` | `attributes[BRAND]` | Só enviado se `BRAND` existir na lista de atributos da categoria (seção 4). |
| `caracteristicas.cor_principal` | `attributes[MAIN_COLOR]` (ou `COLOR`, conforme a categoria) | Idem — melhor esforço, nunca inventa um atributo que a categoria não tem. |
| `sku` | `attributes[SELLER_SKU]` | A documentação de publicação manda o SKU no atributo `SELLER_SKU` (**não** em `seller_custom_field`). Identifica a peça do ERP no anúncio e permite reconhecê-lo se a resposta do `POST /items` se perder (seção 3.1); é pesquisável com `?seller_sku=`. |
| `peso` e pacote padrão | `attributes[SELLER_PACKAGE_WEIGHT / _HEIGHT / _LENGTH / _WIDTH]` | Seção 3.4 — peso do produto (kg → g); dimensões do pacote padrão único, editado numa tela de admin (ADR-027). |
| *(nenhum campo nosso)* | `attributes[GTIN]` / `attributes[EMPTY_GTIN_REASON]` | Peça de brechó não tem GTIN válido — ver seção 5. |
| *(nenhum campo nosso)* | `sale_terms[WARRANTY_TYPE/WARRANTY_TIME]` | Ver seção 6. |
| departamento da categoria (003), `tamanho_etiqueta` e `medidas` | `attributes[GENDER]`, `attributes[SIZE]`, `attributes[SIZE_GRID_ID]`, `attributes[SIZE_GRID_ROW_ID]` | Moda — seção 3.5, só em domínios com tabela de medidas. Para roupa, o conector cria/estende a tabela com `medidas` da peça (ADR-024). |
| *(configuração da categoria)* | `tags: ["immediate_payment"]` | Só quando `settings.immediate_payment = "required"` na categoria. |
| — | `buying_mode="buy_it_now"` | Fixo — único modo suportado atualmente pelo Mercado Livre. |
| — | `listing_type_id` | Valor único configurável do ERP — ver seção 3.2. |

Campos da resposta reaproveitados no `MarketplaceListingSchema` (011, seção 4.2):
`id` (Mercado Livre) → `id_anuncio`; `permalink` → `url_anuncio`.

### 3.1 Criar × atualizar, e falha parcial

O que decide a operação é a entrada de `products.marketplaces[]` (011, seção 4.2) ter ou não
`id_anuncio` — não o `status`:

| Entrada | Operação | Chamadas |
|---|---|---|
| sem `id_anuncio` (nova, ou `erro` antes de o item existir) | **Criar** | `POST /items` → `POST /items/$ITEM_ID/description` (seção 3) |
| com `id_anuncio` e `status = publicado` | **Atualizar** ("Republicar") | `PUT /items/$ITEM_ID` → `PUT /items/$ITEM_ID/description?api_version=2` |
| com `id_anuncio` e `status = encerrado` | **Criar de novo** | como a primeira linha: item novo, com id novo; o `id_anuncio` anterior fica só na auditoria |

- **Atualizar** reenvia `price`, `pictures` (sempre — nunca omitir) e `attributes` (nunca
  `family_name` — ver ⚠ abaixo) e a descrição, com os mesmos critérios e validações das seções 3 a
  6 (inclusive a faixa de preço); `available_quantity` segue `1`. Antes, `GET /items/$ITEM_ID`
  informa `status`, `sold_quantity` e a categoria do anúncio. **Regras de edição (documentação
  "Sincronização e modificação de publicações", 24/03/2026):** com o item ativo podem mudar
  `available_quantity`, `price`, vídeo, `pictures`, descrição e envio; **com vendas**
  (`sold_quantity > 0`) não mudam o título, `buying_mode` nem meios de pagamento.

  ⚠ **`family_name` nunca é reenviado no `PUT /items/$ITEM_ID`** — confirmado ao vivo (T043/T044,
  22/09/2026): o Mercado Livre recusa com `"The field family name is invalid"` mesmo reenviando o
  valor idêntico ou um texto simples sem acento, no modelo *User Products*, independente de
  `sold_quantity`. Contradiz a suposição original desta spec ("editável enquanto sold_quantity =
  0") — editável talvez seja, mas não por este payload; a forma real de mudar o nome de um item já
  criado continua sem confirmação (possivelmente um endpoint próprio, não testado). `title` (modelo
  antigo) segue a regra original (reenviado só com `sold_quantity = 0`), não confirmada ao vivo — a
  conta de produção já está no modelo *User Products*.
- **Descrição na atualização:** `PUT .../description?api_version=2`. Se o item ainda não tem
  descrição (falha parcial anterior), o `PUT` falha e o conector usa `POST`; se ambos falharem, a
  pendência descreve o motivo.
- **Aviso de preço ignorado:** desde 18/03/2026, se o anúncio tem automatização de preços ativa, um
  `PUT` que envie **só** `price` é rejeitado (`400`), e um `PUT` que envie `price` junto de outros
  campos responde `200` com um *warning* dizendo que o preço não foi atualizado. Como a
  atualização sempre envia vários campos, o conector lê os `warnings` da resposta (cada item traz
  `cause_id`, `type`, `code` e `message` — seção 3.6) e, se o preço foi ignorado, o registra em
  `erro` ("preço não atualizado: <motivo>") — o anúncio segue `publicado`. O texto exato desse
  aviso não está documentado; o conector aceita qualquer *warning* como pendência.
- **`erro` preenchido com `status = publicado`** significa "no ar, com pendência" (descrição não
  enviada, preço ignorado). A tela mostra o selo Publicado junto do aviso; um novo "Republicar"
  tenta resolver a pendência e, dando certo, limpa `erro`.
- **Falha parcial na criação:** o item foi criado e a descrição falhou → grava `status =
  publicado`, `id_anuncio` e `url_anuncio` (o anúncio existe e está no ar) e `erro` = "Anúncio
  criado, mas a descrição não foi enviada: <motivo>". "Republicar" **atualiza** esse item e
  reenvia a descrição — nunca cria um segundo (011, seção 4.5).
- **Resposta perdida:** se a conexão cai depois do `POST /items`, o item pode existir sem o ERP
  saber o id. Por isso o anúncio é criado com o `sku` do ERP em `attributes[SELLER_SKU]` e, ao
  retentar uma entrada `erro` sem `id_anuncio`, o conector procura antes, na conta do vendedor, um
  anúncio com aquele SKU e adota o `id` em vez de criar outro. Procedimento (documentação "Busca de
  itens", recurso privado):
  1. `GET /users/{user_id}/items/search?seller_sku={sku}&orders=start_time_desc` — filtra pelo
     atributo `SELLER_SKU` (o filtro `sku` faria o mesmo para `seller_custom_field`, que não usamos).
     Resposta: `{ paging: { limit, offset, total }, results: [ "MLB…", … ] }` — só ids; `limit`
     padrão 50, máximo 100.
  2. `GET /items?ids={id1,id2,…}&attributes=id,status,permalink` (*multiget*, até 20 ids por
     chamada; a resposta vem como lista de `{ code, body }`).
  3. Adota o mais recente cujo `status` **não** seja `closed`. O filtro por status **não** deve ser
     `active`: um item recém-criado pode estar `paused` (imagem ainda sendo baixada) ou
     `under_review`.
  O `user_id` é o do vendedor guardado na credencial (seção 2.1). Atenção: a frase da documentação
  "os resultados serão sempre de itens ativos" vale para a busca **pública**
  (`/sites/{site_id}/search`), não para esta busca privada — que aceita `status` como filtro
  opcional.

### 3.2 Tipo de anúncio (`listing_type_id`)

**Escolha do operador, na mesma tela de revisão da categoria (seção 4; ADR-026)** — não uma
variável de ambiente nem uma decisão de negócio fixada uma vez para todo o ERP. Uma caixa de
seleção, ordenada do mais barato para o mais caro, com `free` (Grátis) pré-selecionado:

| Valor | Rótulo | Ordem (barato → caro) |
|---|---|---|
| `free` | Grátis | 1 — padrão |
| `bronze` | Bronze | 2 |
| `silver` | Prata | 3 |
| `gold` | Ouro | 4 |
| `gold_special` | Clássico | 5 |
| `gold_premium` | Diamante | 6 |
| `gold_pro` | Premium | 7 |

⚠ **Ordem não confirmada por preço real** (ADR-026) — a documentação salva não lista o custo por
categoria (`GET /sites/MLB/listing_prices`, que exige token, não verificado ainda). A ordem acima é
a leitura mais razoável dos nomes; confirma-se na Fase 8 (T043/T044) com a conta real antes do
primeiro anúncio de verdade (T049). Se divergir, é só reordenar a lista — não muda o resto do
desenho.

Lista estática — **sem** consultar `GET /users/{id}/available_listing_types` nem
`GET /sites/MLB/listing_prices` na revisão (ADR-026: mais simples, sem chamada de rede extra). Se
o tipo escolhido não for aceito pela categoria ou pela conta (ex.: `free` bloqueado por volume de
vendas — mais de 5 transações no último ano, `GET
/users/{id}/available_listing_type/free?category_id=` explicaria o motivo, mas o conector não
consulta isso), a publicação falha com `status = erro` e mensagem clara (011, seção 4.6) — o
operador troca de tipo no mesmo painel, sem perder a categoria já escolhida.

Fatos da documentação ("Tipos de publicação"): `gold_special` e `gold_pro` têm duração ilimitada e
pausam com estoque 0; exigem ao menos uma foto; dá para alternar entre os dois sem custo. **Nos
testes, o Mercado Livre pede nunca usar `gold` nem `gold_premium`** — orientação ao operador que
roda a Fase 8 (T043), não um bloqueio de código (em produção são opções válidas).

### 3.3 Modelo *User Products* (`family_name`)

Vendedores com a tag `user_product_seller` em `GET /users/{id}` publicam no modelo *User Products*
(documentação "User Products", 17/06/2026); o escalonamento foi previsto para chegar a 100% dos
vendedores em 2025, e depois da ativação **não** é mais possível publicar no modelo antigo (`title` +
`variations`). Neste modelo:

- Envia-se **`family_name`** (nome genérico da família; usamos `identificacao.nome`), **não** `title`
  — o Mercado Livre monta o `title` a partir da família, do domínio e dos atributos. Não se envia o
  array `variations` (cada variação seria um item; a peça é única).
- `family_name` ≤ `max_title_length` do domínio; a documentação diz que só pode ser alterado
  enquanto nenhuma condição de venda tem vendas, mas o conector **nunca** reenvia `family_name` num
  `PUT /items/$ITEM_ID` — o Mercado Livre recusa mesmo sem vendas (ver ⚠ na seção 3.1). Alterações
  em título, `family_name`, atributos, fotos, condição e quantidade se
  replicam de forma assíncrona para todos os itens do mesmo *User Product* — irrelevante aqui (um
  item por peça).
- O conector lê a tag de `GET /users/me` (o mesmo chamado pelo teste de integração da seção 2.4) e
  escolhe o payload: com a tag, `family_name`; sem ela, `title` (modelo antigo).
- O recurso `/categories` segue igual (atributos e `tags`).
- **Testes:** usuários de teste precisam pedir a "ambientação" ao modelo novo por formulário
  (ativação a cada 7 dias) — sem isso um usuário de teste ainda publica no modelo antigo.
- **Peça usada de moda/esportes no Brasil:** só é aceita com `available_quantity = 1` e, **quando
  vende, o Mercado Livre fecha o item sozinho** (`status = closed`). É o caso de vender no Mercado
  Livre; por isso o "encerrar" da seção 7 é idempotente.

### 3.4 Dimensões e peso do pacote

O Mercado Envios 2 (adoção obrigatória — alerta `shipping.me2_adoption_mandatory`) exige, em
**cada** publicação, quatro atributos com valores **inteiros**, só em cm e g (documentação
"Atributos"): `SELLER_PACKAGE_HEIGHT` (ex.: `"6 cm"`), `SELLER_PACKAGE_LENGTH`, `SELLER_PACKAGE_WIDTH`
e `SELLER_PACKAGE_WEIGHT` (ex.: `"214 g"`). Faltando algum: erro
`item.attribute.missing.seller.package.dimensions` (`cause_id` 5400); decimais ou unidade errada:
`cause_id` 5402. Vendedores em ME1 usam `shipping.dimensions` (fora de escopo — a adoção do ME2 é
obrigatória).

**Decisão (T046/T010, ADR-027): pacote padrão único, editado numa tela de admin.** O ERP tem
`peso` (kg, decimal), mas não as dimensões do pacote, e **não** ganha esses campos nesta versão
(evolução: campos no cadastro do produto, que muda a spec 005). As dimensões vêm de um **único
pacote padrão**, sem exceção por categoria nem por departamento (ADR-027 — mais simples que a
proposta original de T046; uma exceção por categoria vira extensão futura só se o uso real
mostrar necessidade, princípio V):

- Tela **"Contas de marketplace → Pacote padrão do Mercado Livre"** (só admin, spec 011, seção
  2.2) — quatro campos: altura, largura, comprimento (cm) e peso (g), todos inteiros positivos e
  **obrigatórios**. `GET`/`PUT /api/marketplace-accounts/mercado-livre-package-settings`.
- **Guardado no banco** (documento único, `mercado_livre_package_settings`), **não** numa variável
  de ambiente — o admin edita e salva sem reiniciar o backend nem mexer no `.env`.
- **Peso:** vale o `peso` do produto (kg → g, arredondado para cima) quando preenchido; senão o
  peso do pacote padrão — que agora é sempre obrigatório no formulário, então essa reserva nunca
  falta.
- **Sem pacote configurado ainda:** a publicação falha antes do `POST`, com mensagem clara
  apontando para a tela de configuração.
- **Formato enviado:** `"{n} cm"` e `"{n} g"`, inteiros.
- **Limitação assumida:** o mesmo pacote serve para toda peça, de qualquer categoria ou
  departamento — uma peça muito diferente do padrão (casaco, edredom) usa o mesmo pacote por
  enquanto. Auditado (`MERCADO_LIVRE_PACKAGE_SETTINGS_UPDATE`, spec 008) a cada alteração.

### 3.5 Moda: gênero, tamanho e tabela de medidas

Fonte: documentação "Tabelas de medidas" ("Primeiros passos", "Gerenciar tabela de medidas" e
"Validação da tabela de medidas"). No Brasil existem três tipos de tabela: `BRAND` (da marca),
`STANDARD` (padrão do Mercado Livre) e `SPECIFIC` (do vendedor).

Em alguns domínios de moda a tabela de medidas é obrigatória. Depois da categoria confirmada na
revisão (seção 4; ADR-025), que resolve o `domain_id` (ex.: `MLB-SHIRTS`), o conector segue:

1. **O domínio usa tabela?** `GET /catalog/charts/MLB/configurations/active_domains` →
   `{ domains: [ { domain_id } ] }` (`404 config_not_found` = nenhum domínio ativo). Domínio fora da
   lista: nada de tabela, segue o fluxo normal. ⚠ A documentação descreve a lista como a dos "domínios
   com a experiência da tabela de medidas" e diz que ela é obrigatória em "alguns domínios de moda";
   tratamos todo domínio ativo como obrigatório — o lado seguro, já que associar uma tabela não é
   recusado onde ela é opcional.
2. **Quais atributos definem a tabela?** `GET /domains/{domain_id}/technical_specs` — atributos com
   `value_type` `grid_id`/`grid_row_id` (`SIZE_GRID_ID`, `SIZE_GRID_ROW_ID`) e os com a tag
   `grid_template_required` (em geral `BRAND` e `GENDER`).
**Resultado do T050 (21/09/2026, conta real conectada, só leituras).** `active_domains` lista 59
domínios no MLB, e quase todos os de roupa que interessam ao brechó (camisas, camisetas, vestidos, blusas,
calças, shorts, saias, jaquetas e casacos) exigem tabela — mas **só calçados têm tabela pronta**:
`POST /catalog/charts/domains/search` lista tabelas `STANDARD` apenas para `SNEAKERS`,
`BOOTS_AND_BOOTIES`, `FOOTBALL_SHOES` e `LOAFERS_AND_OXFORDS`, e tabelas `BRAND` apenas para 9 domínios de
calçado; para roupas, a busca `STANDARD` devolve 0 tabelas. A política "só `BRAND`/`STANDARD`" basta
para **calçados**, mas **não publica roupas**: é preciso uma tabela `SPECIFIC`, do próprio vendedor.

**Decisão (T053, ADR-024): o ERP cria/estende as tabelas `SPECIFIC` de roupa por API**, alimentadas
pelas medidas reais de cada peça (`medidas` — spec 005) — cada peça é única e tem SKU próprio
(constituição, princípio X), então a medida real da peça já é o que a tabela precisa, sem inventar
uma segunda fonte "genérica" só para o marketplace. Fluxo completo, unindo calçado e roupa:

3. **Achar a tabela** — `POST /catalog/charts/search?offset=1&limit=100` com `{ domain_id (sem o
   prefixo do site, ex.: "SHIRTS"), site_id: "MLB", seller_id, attributes: [{ id: "GENDER", values:
   [{ name }] }, { id: "BRAND", values: [{ name }] }] }` → `{ paging, charts: [{ id, type,
   main_attribute_id, … }] }`.
   - **Calçado:** ordem de preferência **`BRAND`** (se a marca da peça tiver tabela), depois
     **`STANDARD`**. Domínio sem tabela ativa responde `400 domain_not_active`. Sem `BRAND` nem
     `STANDARD`, bloqueia (calçado nunca cria/estende tabela própria).
   - **Roupa (ADR-030):** tenta **`BRAND`** (marca da peça) e depois **`STANDARD`** primeiro, mesma
     ordem do calçado — quando existe uma tabela oficial e ela já tem uma linha com o `SIZE` da
     peça, reaproveita direto, **sem exigir nenhuma medida** (`GARMENT_*`) do cadastro. Só quando
     não existe tabela oficial (`BRAND`/`STANDARD`) para o domínio+gênero, ou existe mas não tem o
     `SIZE` da peça, o conector cai para a tabela **`SPECIFIC`** própria: busca com
     `type: "SPECIFIC"` e `seller_id` da própria conta — sem resultado (`charts: []`), **cria** a
     tabela (passo 3a); com resultado, reaproveita a existente e segue para o passo 4. Diferente do
     calçado, roupa sem tabela oficial nunca bloqueia — sempre pode criar/estender a própria
     `SPECIFIC`.
3a. **Criar a tabela `SPECIFIC` (só roupa, só na primeira peça de um domínio+gênero)** —
   `GET /domains/{domain_id}/technical_specs?section=grids` para obter os atributos
   `CLOTHING_MEASURE` daquele domínio, depois `POST /catalog/charts` com `measure_type:
   "CLOTHING_MEASURE"`, `domain_id`, `site_id: "MLB"`, `attributes: [{ id: "GENDER", values: […] }]`,
   `main_attribute: { attributes: [{ site_id: "MLB", id: "SIZE" }] }` e uma primeira `row` com a
   peça atual (`SIZE` + os atributos `GARMENT_*`, tabela de mapeamento abaixo). O nome
   (`names.MLB`) é gerado pelo conector (≤ 60 caracteres, só letras/números/espaços — ex. "Tabela
   OpenERP Sample — Calças Feminino"), nunca digitado pelo operador.
4. **Escolher ou adicionar a linha:**
   - `GET /catalog/charts/{chart_id}` → `rows: [{ id: "569686:1", attributes: [...] }]`. Para
     **calçado**, a linha certa é a cujo `SIZE` é **igual** ao tamanho da peça
     (`tamanho_etiqueta`; se não bater, `tamanho_equivalente`).
   - Para **roupa**, a linha certa é a cujo `SIZE` é **igual** ao tamanho da peça (ADR-029) —
     achando, reaproveita, mesmo que os `GARMENT_*` da linha não sejam idênticos aos desta peça;
     não achando nenhuma linha com aquele `SIZE`, **adiciona** uma linha nova
     (`POST /catalog/charts/{chart_id}/rows`) com os `GARMENT_*` desta peça — nunca edita uma
     linha existente (pode já estar associada a outro anúncio) e nunca recria a tabela.
     ⚠ Decisão original (ADR-024): achar por `SIZE` + todos os `GARMENT_*` idênticos, uma linha
     por combinação de medida real (princípio X). **Revertida pela ADR-029** (erro real ao vivo,
     25/09/2026): o Mercado Livre recusa duas linhas com o mesmo `SIZE` e um `GARMENT_*`
     diferente (`"Duplicated measure in attribute ... was found in row SIZE ..."`) — `SIZE` é,
     na prática, a chave única de linha da tabela `SPECIFIC` para medidas, não uma combinação.
   - Em ambos os casos, o `GENDER` do item e o da tabela precisam ser idênticos.
4a. **`FILTRABLE_SIZE` é lista fechada, não texto livre (ADR-033).** Ao criar/adicionar uma linha
   na `SPECIFIC` (passo 3a/4), `FILTRABLE_SIZE` "espelha" `SIZE` (T043), mas **exige o `id` do
   valor**, obtido de `technical_specs?section=grids` (mesma consulta do passo 3a) — achado real
   ao vivo, 25/09/2026: `"Value 48 in attribute FILTRABLE_SIZE is incorrect"`, mesmo com um valor
   "limpo" (`"48"`) e sem nenhuma linha conflitante. Mandar `{ id, name }` resolvido (achando o
   `size` na lista de valores do atributo `FILTRABLE_SIZE`) em vez de só `{ name }` resolve; sem
   correspondência na lista, a publicação falha **antes** do `POST`, com os valores aceitos do
   domínio na mensagem — mesmo padrão de "erro claro antes de tentar" de medida em branco e
   calçado sem tamanho. `SIZE` continua texto livre, sem essa exigência.
5. **Enviar no item:** `attributes[GENDER]`, `attributes[SIZE]`, `attributes[SIZE_GRID_ID]`
   (`value_name` = id da tabela) e `attributes[SIZE_GRID_ROW_ID]` (`value_name` = `id` da linha, no
   formato `"{chart_id}:{n}"`).

O `GENDER` sai do departamento da categoria do ERP (Masculino, Feminino, Infantil…), casado com os
valores de `GET /categories/$CATEGORY_ID/attributes`; o Mercado Livre pode pedir também `AGE_GROUP`
por *warning* de validação (seção 3.6). O `GENDER` é validado ainda contra o título.

**Medidas exigidas por roupa (`MedidasSchema`, spec 005) → atributo `GARMENT_*`.** Confirmado para
domínios de parte de baixo (calças, shorts, saias — documentação "Gerenciar tabela de medidas",
exemplo `PANTS_TEST`) e, desde o T060 (23/09/2026) e 24/09/2026 (erro real publicando uma
jaqueta), para parte de cima:

| Campo do ERP | Atributo(s) `GARMENT_*` |
|---|---|
| `medidas.comprimento` | `GARMENT_LENGTH_FROM`, `GARMENT_LENGTH_TO` |
| `medidas.cintura` | `GARMENT_WAIST_WIDTH_FROM` |
| `medidas.quadril` | `GARMENT_HIP_WIDTH_FROM` |
| `medidas.coxa` (ADR-024) | `GARMENT_THIGH_WIDTH_FROM` |
| `medidas.entrepasso` (ADR-024) | `GARMENT_INSEAM_LENGTH_FROM` |
| `medidas.gancho` | `GARMENT_FRONT_RISE_FROM` |
| `medidas.busto` (T060) | `GARMENT_CHEST_WIDTH_FROM`, `GARMENT_CHEST_WIDTH_TO` |
| `medidas.largura_ombro` (novo, 24/09/2026) | `GARMENT_SHOULDER_WIDTH_FROM`, `GARMENT_SHOULDER_WIDTH_TO` |
| `medidas.comprimento_manga` (novo, 24/09/2026) | `GARMENT_SLEEVE_LENGTH_FROM`, `GARMENT_SLEEVE_LENGTH_TO` |

Cada peça do brechó é uma peça única com uma medida real, não uma faixa de tamanho (constituição,
princípio X). ⚠ Decisão original: `_FROM` e `_TO` do mesmo atributo mandavam o mesmo valor.
**Revertida pela ADR-030** (erro real ao vivo, 25/09/2026, `duplicated_measure_value`): o Mercado
Livre recusa `_FROM` igual a `_TO` na mesma linha. `_FROM` e `_TO` passam a abrir uma faixa
estreita de ±1cm em torno do valor real (`_FROM = valor - 1`, `_TO = valor + 1`) — só para
satisfazer o schema deles; `medidas` no cadastro do produto continua com o valor real único,
inalterado.

A causa de `technical_specs` não revelar os atributos de uma peça (T060, 23/09/2026) era consultar
sem o `GENDER` no corpo — corrigido (`getDomainSizeChartAttributes` virou `POST` com `GENDER`
resolvido), então a consulta em si já traz o conjunto real e completo por domínio+gênero. A
implementação consulta `technical_specs` do domínio antes de montar a linha; atributos que
apareçam ali e que o ERP não capture ainda geram uma extensão nova de `MedidasSchema`, nunca um
valor adivinhado — a mensagem de erro já inclui o nome real que o Mercado Livre devolveu para
facilitar a extensão (foi assim que ombro/manga foram descobertos e confirmados).

Consequências já certas:
- **`SIZE` é obrigatório** e precisa ser igual ao da linha. No ERP de desenvolvimento, 7 de 9 produtos
  não têm `tamanho_etiqueta`; publicar moda exige o tamanho, senão a publicação falha antes do `POST`
  ("Informe o tamanho da peça").
- **Roupa também exige as medidas** que o domínio pedir (tabela acima, ou o que `technical_specs`
  confirmar para partes de cima) preenchidas em `medidas` — faltando alguma, a publicação falha
  antes do `POST` ("Informe <medida> para publicar esta peça no Mercado Livre").
- **Vocabulário de tamanhos (calçado):** as linhas `STANDARD` usam `"34,0 BR"`; o ERP guarda `"32"` —
  é preciso normalizar (número → `"N,0 BR"`). Em roupa, o `SIZE` da tabela `SPECIFIC` é o próprio
  `tamanho_etiqueta` do ERP (o conector é quem cria a tabela, então já nasce no vocabulário certo).

**Sem tabela (calçado) ou sem medida mínima (roupa):** a publicação falha **antes** do `POST`, com
`status = erro` e mensagem clara ("Não há tabela de medidas para <domínio>/<gênero>/<marca> com o
tamanho <X>", ou "Informe <medida> para publicar esta peça no Mercado Livre").

Erros de validação da tabela (`type` `error` bloqueia): `missing.fashion_grid.grid_id.values`,
`missing.fashion_grid.grid_row_id.values`, `missing.fashion_grid.size.values` (falta `SIZE`),
`invalid.fashion_grid.grid_id.values`, `invalid.fashion_grid.grid_row_id.values` e
`invalid.fashion_grid.seller_id.values` (tabela `SPECIFIC` de outro vendedor); `invalid.fashion_grid.
size.values` (`SIZE` ou `GENDER` divergentes da tabela) é *warning*. **Moderação:** anúncios criados
que descumpram essas validações são moderados e **pausados depois** — o problema pode aparecer
depois do `POST`, não só nele (o ERP não monitora isso nesta versão).

### 3.6 Erros do Mercado Livre

Erros de validação chegam como `{ message: "Validation error", error: "validation_error", status:
400, cause: [ { department, cause_id, type, code, references, message } ] }` (documentação
"Validações"). `type: "warning"` **não bloqueia** (a chamada segue e o aviso volta também em
`warnings` nas respostas de sucesso); `type: "error"` bloqueia e exige mudar o JSON. O conector
mostra ao operador o `message` das causas `error` e traduz os códigos que já conhecemos:
`item.price.invalid` (preço mínimo/máximo), `item.pictures.max`, `item.pictures.invalid_size`,
`item.title.minimum_length`, `item.attribute.missing_conditional_required` (GTIN),
`item.attribute.missing.seller.package.dimensions`, `moderations.seller.not_authorized` (marca/
categoria sem autorização), `item.description.type.invalid`. Erros sem `cause` têm a forma `{
message, error, status, cause: [] }`. Nunca vai token nem `client_secret` para a mensagem.

## 4. Categorização

**Revisão humana obrigatória, em toda publicação (ADR-025).** Diferente do resto do fluxo (spec
011, seção 4.3), categorizar não é uma decisão só do conector — é uma etapa própria, entre
"Publicar" e a criação de fato do anúncio, sempre com confirmação do operador. Motivo: o T050
mostrou o preditor errando o domínio de peças comuns, e o domínio decide qual tabela de medidas o
anúncio exige (seção 3.5) — desde a ADR-024, uma categoria errada também cria/alimenta uma tabela
`SPECIFIC` no domínio errado no Mercado Livre, um estado externo que não tem como corrigir depois.

```text
Operador clica em "Publicar no Mercado Livre" (ou "Republicar")
        ↓
Sistema chama o preditor de categorias com o nome do produto
        ↓
Tela de revisão: categoria sugerida (pré-selecionada) + lista curada de
categorias de Roupas, Calçados e Bolsas para escolher outra
        ↓
Operador confirma a sugestão ou escolhe outra categoria
        ↓
Sistema publica de fato, usando o `category_id` confirmado
```

**Preditor** ("Categorização de produtos"), chamado só para gerar a sugestão pré-selecionada —
nunca decide sozinho:

```
GET https://api.mercadolibre.com/sites/MLB/domain_discovery/search?limit=1&q={nome do produto}
→ [{ domain_id, domain_name, category_id, category_name, attributes: [{ id, value_id, value_name }] }]
```

`q` é o nome do produto, todo no idioma do site; `limit` vai de 1 a 8 (padrão 4). O primeiro
resultado (maior probabilidade) vira a sugestão pré-selecionada na tela de revisão — nunca é usado
direto sem confirmação. Se a chamada ao preditor falhar (rede, Mercado Livre fora do ar), a tela de
revisão aparece igual, só sem pré-seleção — o operador escolhe manualmente da lista curada; a
publicação não trava por isso. O preditor também devolve atributos já reconhecidos (ex.: `BRAND`),
que o conector pode aproveitar quando o ERP não tem o dado.

⚠ **Precisão do preditor (T050).** Com consultas de peças comuns o preditor devolveu domínios
inesperados — "camisa masculina" → `MLB-RUGBY_JERSEYS` e "jaqueta masculina" →
`MLB-FOOTBALL_JACKETS` — a evidência que motivou a revisão obrigatória acima (ADR-025), em vez de
publicar direto com o resultado do preditor.

**Lista curada** (para o `<select>` da tela de revisão): as categorias-folha da sub-árvore
"Calçados, Roupas e Bolsas" (`MLB1430`) do site MLB — não a árvore inteira do Mercado Livre
(milhares de categorias, inviável como lista suspensa, e fora do que o brechó vende). Levantada
uma vez (T057) por `GET /categories/{id}` recursivo — público, sem token — e congelada em
`backend/src/plugins/marketplaces/mercado-livre-category-catalog.json`, versionado no
repositório (não é uma variável de ambiente: é dado de taxonomia do Mercado Livre, não uma
preferência operacional da dona do brechó — diferente do pacote padrão, seção 3.4); atualizada
rodando `npm run fetch:mercado-livre-categories` de novo se o Mercado Livre mudar essa taxonomia.
**Feito** (22/09/2026): 207 categorias-folha.

`API: POST /api/products/:id/marketplace-category-suggestion` — ver spec 011, seção 4.5. O
`category_id` que o operador confirma na tela de revisão vai, junto do resto do formulário, no
corpo de `POST /api/products/:id/marketplace-listings` (`categoryId`, spec 011 seção 4.5) — o
conector **não** chama mais o preditor por dentro de `publish()`; recebe o `category_id` já
resolvido.

**Revisão de tamanho (achado real 24/09/2026, calçado; ADR-032/033, 25/09/2026, roupa), na
mesma tela.** Calçado usa tabela `BRAND`/`STANDARD`, fixa — o ERP não pode criar uma linha nova
nela (diferente da `SPECIFIC` de roupa, seção 3.5). Publicar direto com o `tamanho_etiqueta` do
cadastro, sem checar antes, gerava um erro cru e sem saída ("a tabela não tem o tamanho X")
sempre que o vocabulário do cadastro não batia exatamente com o da tabela — e, para roupa
(achados reais 25/09/2026), o próprio `tamanho_etiqueta` podia nem ser um valor aceito pelo
Mercado Livre: primeiro um rótulo composto (`"FR 48 / US 19"`, `invalid_row_attribute_value`),
depois — mesmo um valor "limpo" como `"48"` — porque `FILTRABLE_SIZE` é lista fechada do
domínio (ADR-033, seção 3.5, passo 4a), não texto livre. Depois de o operador confirmar a
categoria, o sistema consulta os tamanhos já aceitos naquela categoria (`POST
/api/products/:id/marketplace-size-suggestion`, com o `categoryId` já escolhido — calçado e
roupa, ambos) e:

- se o tamanho do cadastro já bate (`currentMatches`), não mostra nada — segue direto;
- se não bate, mostra um `<select>` com os tamanhos já aceitos pra escolher (mesmo espírito da
  revisão de categoria: nunca finge que bate quando não bate);
- **calçado**: sem tabela nenhuma (nem `BRAND` nem `STANDARD`), avisa que não é possível
  publicar esse calçado nessa categoria — sem tentar, sem erro cru do Mercado Livre
  (`allowCustomSize: false` — calçado nunca cria tabela própria, ADR-024).
- **roupa**: a lista junta a lista fechada de `FILTRABLE_SIZE` do domínio (ADR-033 — a fonte
  mais confiável, existe mesmo sem nenhuma tabela criada ainda) com a tabela `BRAND`/`STANDARD`
  oficial (se existir, ADR-030) e os tamanhos já usados na `SPECIFIC` do próprio vendedor (se já
  existir uma pra esse domínio+gênero). Quando o domínio declara `FILTRABLE_SIZE` como lista
  fechada — o caso comum — só um valor dela funciona, então a tela **não** oferece texto livre
  (`allowCustomSize: false`); só nos domínios raros sem essa lista declarada é que a tela aceita
  um tamanho digitado, que vira uma linha nova na `SPECIFIC` (ADR-032, seção 3.5).

O tamanho escolhido/digitado (`sizeOverride`) viaja junto de `categoryId`/`listingTypeId` no
corpo de `POST /api/products/:id/marketplace-listings`; tem prioridade sobre `tamanho_etiqueta`
só pra essa publicação — nunca é gravado de volta no cadastro (o cadastro continua sendo a
fonte de verdade da peça; o Mercado Livre só recebe o valor mais próximo que ele aceita).

**Revisão de atributos obrigatórios (ADR-035, 28/09/2026), na mesma tela, depois da
categoria.** Cada categoria exige atributos que o cadastro não tem como campo ("tipo de roupa",
"tipo de manga", "tipo de calça"... — ~28 na lista curada). Depois de o operador confirmar a
categoria, o sistema consulta `POST /api/products/:id/marketplace-attribute-suggestion` (com o
`categoryId` escolhido, só leituras) e mostra uma caixa de seleção para cada obrigatório que o
cadastro não cobre, com as opções da própria categoria — pré-selecionada quando a
`classificacao.subcategoria` é a mesma palavra de uma opção. Em atributo `value_type: "list"`
(lista fechada) só as opções valem; em `"string"`, a tela também aceita texto digitado. O botão
de publicar fica bloqueado até todas terem valor. As escolhas viajam em `extraAttributes` no
corpo de `POST /api/products/:id/marketplace-listings`, valem só pra essa publicação e nunca
são gravadas no cadastro. Se algum obrigatório ainda faltar na publicação (chamada sem passar
pela revisão), ela falha antes de qualquer escrita, com o nome dos atributos.

**Regra geral de atributos (ADR-035):** atributo `list` nunca é enviado sem `value_id` — sem
correspondência, sai do payload (se for opcional, como `MAIN_COLOR`) ou vira pendência da
revisão (se obrigatório). Atributo `string` aceita texto livre; o `value_id` é mandado quando o
texto é a mesma palavra de uma sugestão (sem acento, hífen como espaço).

**Revisão de frete (achado real 24/09/2026), depois de categoria/tamanho/tipo de anúncio.**
Publicar sem declarar `shipping` no `POST /items` deixa o Mercado Livre aplicar um padrão
próprio — achado real: um anúncio publicado ficou com "envio por conta do comprador" e um aviso
sobre o modo `me1` não estar ativado na conta (que nunca configurou frete nenhum
explicitamente). Depois de categoria e tipo de anúncio confirmados, o sistema consulta
`POST /api/products/:id/marketplace-shipping-suggestion`, que por sua vez chama `POST
/users/{sellerId}/shipping_modes` do Mercado Livre (documentação oficial en_us/es_ar
consistente, mas com o exemplo de `curl` malformado nas duas fontes — o formato do corpo segue o
JSON de exemplo completo, não o `curl`; **ainda não confirmado contra a API real**) — devolve as
combinações de modo+tipo de logística realmente válidas pra aquela peça/categoria/tipo de
anúncio, cada uma com o requisito de frete grátis (`mandatory`/`required` = obrigatório,
`not_allowed` = proibido, `optional` = escolha do operador). A tela pré-seleciona a combinação
`default` do Mercado Livre; o operador pode trocar. **Nunca bloqueia a publicação**: se a
consulta falhar ou não achar opção nenhuma, publica sem declarar `shipping` — mesmo
comportamento de antes dessa funcionalidade existir, nunca pior.

Alternativa descartada: caixa de seleção estática (ex.: "Frete grátis" vs. "Comprador paga"),
sem consultar o Mercado Livre antes — mais rápida de entregar, mas sem garantia de que toda
categoria aceita as duas opções (decisão do usuário, 24/09/2026: mesmo padrão de rigor da
revisão de categoria/tamanho, nunca oferecer uma escolha que pode não ser válida pra aquele
item específico).

Alternativa descartada (categoria): mapeamento configurável categoria do ERP (003) → categoria do
Mercado Livre, com o preditor só como reserva e sem revisão humana — rejeitada porque, com a
revisão já obrigatória a cada publicação, esse mapeamento não reduziria risco que a revisão já
não cobrisse, só adicionaria uma configuração (12 categorias) para manter em sincronia com a
taxonomia do Mercado Livre (ADR-025).

Com o `category_id` confirmado, o conector consulta dois recursos:

- `GET /categories/$CATEGORY_ID` → `settings`: `max_title_length`, `minimum_price`, `maximum_price`
  (pode ser `null`), `item_conditions`, `max_pictures_per_item`, `max_description_length`,
  `immediate_payment`, `listing_allowed`, `buying_allowed` e `status`. A categoria só serve se
  `listing_allowed` for verdadeiro e `status = enabled`; senão a publicação falha com mensagem clara.
- `GET /categories/$CATEGORY_ID/attributes` → atributos e suas `tags` (documentação "Atributos"):
  `required` — obrigatório; `new_required` — obrigatório quando a condição é Novo;
  `conditional_required` — depende do item: `POST /categories/$CATEGORY_ID/attributes/conditional`
  com o corpo do item devolve `{ required_attributes: [...] }` (disponível no Brasil);
  `read_only`, `fixed` e `inferred` — o Mercado Livre preenche, o vendedor **não** envia; `hidden` —
  não aparece no site, mas pode ser enviado pela API; `multivalued` — vários valores separados por
  vírgula. Atributo de lista aceita só `value_name` para um valor novo ou `value_id` + `value_name`
  para um valor conhecido; atributo numérico com unidade vai em `value_name` (ex.: `"6 cm"`).

O conector monta o array `attributes` (seção 3) enviando só atributos que a categoria de fato aceita
e que o ERP sabe.

## 5. Identificadores de produto (GTIN)

Peça de brechó (usada, sem embalagem original) nunca tem um GTIN/EAN válido para informar. O GTIN é
exigido quando tem `tags.required`, ou quando tem `tags.conditional_required` **e** o
`POST /categories/$CATEGORY_ID/attributes/conditional` (com o corpo do item) devolve `GTIN` em
`required_attributes` — uma resposta `[]` significa que o item está dentro das exceções e nada é
enviado. Sendo exigido, o conector envia o atributo `EMPTY_GTIN_REASON` (documentação
"Identificadores de produtos"), com um dos valores da lista fixa devolvida por
`GET /categories/$CATEGORY_ID/attributes`:

```json
{ "id": "EMPTY_GTIN_REASON", "value_id": "17055160", "value_name": "No registrado" }
```

Valores: `Artesanal` (`17055158`) — confecção própria; `Kit` (`17055159`) — conjunto de produtos;
`No registrado` (`17055160`) — artigo ainda não registrado; `Otro` (`17055161`) — outro motivo que
impede o vendedor de carregar o GTIN. Usamos **`No registrado`**, o mais próximo da realidade de uma
peça usada sem código; `Otro` é a alternativa se o Mercado Livre contestar. O `value_id` vem sempre
da resposta da categoria, nunca fixo no código. A documentação pede priorizar o GTIN quando existir
(o ERP não o tem) e **nunca** se inventa um GTIN. Sem o atributo, o erro é
`item.attribute.missing_conditional_required` (`cause_id` 7810).

## 6. Preço mínimo e garantia

- Antes de publicar, valida `price` contra `settings.minimum_price` e `settings.maximum_price` (este
  pode ser `null` — sem teto) de `GET /categories/$CATEGORY_ID` (mesma chamada que resolve os
  atributos, seção 4) — se fora da faixa, falha com `status = erro` (011, seção 4.6) e mensagem
  clara, sem tentar a chamada de publicação. Se o Mercado Livre ainda assim recusar, o erro é
  `item.price.invalid`.
- Garantia (`sale_terms`): **sem garantia** por padrão (peça usada, sem garantia de fábrica
  nem do vendedor). Exceção: quando `attributes[ITEM_CONDITION] = "Recondicionado"`, o
  Mercado Livre exige garantia — `GET /categories/$CATEGORY_ID/sale_terms` traz os valores válidos;
  o conector envia `WARRANTY_TYPE = "Garantia do vendedor"` / `WARRANTY_TIME = "90 dias"`
  automaticamente nesse caso. O ERP hoje não distingue "recondicionado" em `condicao.estado` (005)
  — até que essa distinção exista no cadastro, este conector nunca publica como recondicionado
  (mapeia `usado`/`seminovo` para `"Usado"`, nunca `"Recondicionado"` — seção 3).

## 7. Encerrar anúncio

Implementa `MarketplaceConnectorPort.close(...)` (011, seção 4.7):

```
PUT https://api.mercadolibre.com/items/$ITEM_ID     { "status": "closed" }
```

- Encerrar tira o anúncio do ar (o item passa a `closed`); é a **única** forma de remoção desta
  versão. `closed` é o estado final: **não dá para reativar** um item encerrado, só publicar de novo.
  O próprio Mercado Livre descarta itens encerrados depois de um tempo, então não há necessidade de
  excluí-los. Excluir de vez (segundo `PUT` com `{"deleted":"true"}` sobre item já encerrado — o valor
  é a string `"true"` na documentação de produtos) e pausar/reativar (`paused`/`active`) ficam fora
  de escopo (seção 8). Fonte: "Sincronização e modificação de publicações" (24/03/2026).
- **Pré-condição no ERP** (011, seção 4.7): entrada `publicado`, conta ativa e
  `connectionStatus = connected`. A renovação de token sob demanda (seção 2.3) vale aqui também.
- **Conflito de versão:** `409` com "optimistic locking error" é transitório — o conector espera
  alguns segundos e repete, até 3 vezes; esgotadas, falha com mensagem pedindo para tentar mais
  tarde, sem alterar o status do anúncio no ERP.
- **Idempotente:** antes do `PUT`, `GET /items/$ITEM_ID`; se o `status` já é `closed` (inclusive
  porque a peça vendeu lá e o Mercado Livre fechou sozinho), o conector trata como sucesso — o
  estado desejado já existe. A documentação não define um código de erro específico para "já
  encerrado", por isso a checagem é por `status`.
- **Itens fora do estado normal:** um item `under_review` (com `sub_status` `forbidden`, `held`,
  `waiting_for_patch`, `pending_documentation`) ou em `payment_required` pode não aceitar
  `closed` (o `forbidden`, por exemplo, só aceita exclusão direta). Nesses casos o `PUT` falha e a
  mensagem do Mercado Livre é mostrada ao operador com a orientação de resolver a pendência no
  painel do Mercado Livre.
- **Encerrado não volta:** este conector não reativa um item `closed`. Publicar de novo uma entrada
  `encerrado` cria um item novo com `POST /items` (seção 3.1), com os dados **atuais** do ERP.
  `POST /items/$ITEM_ID/relist` existe (cria um item novo copiando o antigo e preserva visitas e
  vendas se feito em até 60 dias do encerramento), mas só aceita `price`, `quantity` e
  `listing_type_id` — não atualizaria título, fotos nem atributos — e para uma peça única o
  histórico de visitas não compensa. Fica fora de escopo (seção 8).
- Sucesso → o serviço grava `status = encerrado` e `encerrado_em` (011, seção 4.2). Falha nunca é
  silenciosa: a entrada segue `publicado`, com `erro` = "Falha ao encerrar: <motivo>" e a opção de
  tentar de novo.

## 8. Fora de escopo (evolução futura)

```text
Excluir o anúncio (`deleted: true`) depois de encerrado, pausar/reativar (`paused`) e
republicar um anúncio encerrado reaproveitando o mesmo item (`relist`) — a remoção
desta versão é só "encerrar" (seção 7)

Encerrar automaticamente o anúncio quando a peça é marcada como vendida no ERP — a tela
só avisa (011, seção 4.7); a decisão é do operador

Detectar que o Mercado Livre vendeu/encerrou o item por conta própria (faz parte da
sincronização de status, abaixo)

Tela de administração das tabelas `SPECIFIC` (editar/mesclar linhas manualmente) — a v1 só cria e
adiciona linha por API, sem interface própria (seção 3.5)

Dimensões do pacote por produto no cadastro (o pacote padrão único, editável numa tela de admin,
segue dentro do escopo desde a ADR-027 — seção 3.4); exceção de pacote por categoria/departamento

Suporte a variações (múltiplos tamanhos/cores por anúncio) — já fora de escopo
em 011; Mercado Livre usa isso via "User Products"/UPtin, não aplicável a
peça única

Sincronização de estoque/preço/status de pedidos feitos no Mercado Livre de
volta para o ERP (já fora de escopo em 011)

Anúncios com Mercado Envios configurado automaticamente (frete) — publicação
inicial não define modo de envio, Mercado Livre aplica o padrão da conta

Worker/job de renovação periódica de token — renovação é sempre sob demanda
(seção 2.3)

Catálogo do Mercado Livre (publicação vinculada a um produto de catálogo
já existente) — este conector sempre cria um anúncio "solto", nunca associado
a um catalog_product_id
```

## 9. Critérios de aceite

- O cadastro de uma conta Mercado Livre pede só Client ID e Client Secret; access/refresh
  token nunca são digitados.
- O cadastro de conta nova do Mercado Livre pede o usuário do Mercado Livre (apelido ou ID); depois do OAuth, se
  o usuário que autorizou for outro, a conexão é recusada (`400`) sem gravar tokens, e a mensagem diz quem
  autorizou e quem era esperado (seção 2.5). Editar o usuário esperado desconecta a conta.
- O botão "Criar e conectar ao Mercado Livre" fica bloqueado até "Testar integração" passar
  (seção 2.4), e volta a bloquear se Client ID ou Client Secret for editado depois.
- Cadastrar uma conta Mercado Livre completa o fluxo OAuth (seção 2.2) e persiste
  `access_token`/`refresh_token`/`expires_at` criptografados, com `connectionStatus =
  "connected"`; `state` de uso único e com validade de 10 min.
- Publicar um produto com dados mínimos completos (011, seção 4.6) cria um item real no
  Mercado Livre e grava `id_anuncio`/`url_anuncio` corretos na entrada de `marketplaces`.
- Publicar numa categoria cujo GTIN é `conditional_required` nunca falha por falta de GTIN —
  o conector sempre envia `EMPTY_GTIN_REASON`.
- Publicar com preço abaixo do `minimum_price` da categoria falha **antes** de qualquer
  chamada à API do Mercado Livre, com mensagem indicando o valor mínimo.
- Publicar com `access_token` expirado, mas `refresh_token` ainda válido, renova
  automaticamente e completa a publicação sem exigir nova autorização do admin.
- Publicar com `refresh_token` também expirado falha com mensagem clara pedindo para
  reconectar a conta, e marca `connectionStatus = "expired"`.
- A descrição do produto é enviada numa chamada separada, depois do item criado com sucesso —
  falha ao enviar a descrição não desfaz a criação do item: a entrada fica `publicado`, com
  `id_anuncio`/`url_anuncio` e `erro` descrevendo a pendência (seção 3.1).
- Republicar uma entrada `publicado` (ou uma que ficou com a descrição pendente) atualiza o item
  existente com `PUT` — nunca cria um segundo item — e sempre reenvia `pictures`; o `title` só é
  enviado quando `sold_quantity = 0`.
- Se a resposta de uma atualização trouxer *warning* de preço ignorado (automatização de preços), o
  anúncio segue `publicado` e `erro` registra "preço não atualizado".
- Retentar uma entrada `erro` sem `id_anuncio`, depois de uma resposta perdida, adota o anúncio
  já existente com aquele SKU em vez de duplicá-lo.
- Republicar uma entrada `encerrado` cria um item novo, com `id_anuncio` novo.
- Toda renovação de token é gravada mesmo que a operação de negócio falhe depois, e duas
  operações simultâneas na mesma conta gastam o `refresh_token` uma única vez (seção 2.3).
- Um `invalid_grant` na renovação marca a conta `expired`; um erro de rede não altera o status.
- O `listing_type_id` enviado é o que o operador escolheu na tela de revisão, do menor custo para
  o maior, com `free` pré-selecionado (seção 3.2; ADR-026) — nunca uma variável de ambiente fixa.
- Encerrar um anúncio `publicado` envia `PUT /items/$ITEM_ID` com `status = closed` e grava
  `status = encerrado` e `encerrado_em`; repetir a operação sobre um item já encerrado é
  sucesso; um `409` de versão é repetido antes de falhar; conta inativa ou não conectada é
  rejeitada sem chamar o Mercado Livre (seção 7).
- O anúncio é criado no modelo *User Products* (`family_name`, sem `title` nem `variations`) quando o
  vendedor tem a tag `user_product_seller`, e no modelo antigo (`title`) quando não tem (seção 3.3).
- O SKU do ERP vai em `attributes[SELLER_SKU]` e é encontrado por `?seller_sku=` na busca de itens do
  vendedor (seção 3.1).
- A descrição é criada com `POST` e substituída com `PUT ...?api_version=2`; texto com HTML/emoji é
  saneado antes de enviar (seção 3).
- Toda publicação leva as quatro dimensões do pacote como inteiros em cm e g, resolvidas pelo pacote
  padrão configurável (categoria > departamento > padrão) e pelo peso do produto; sem configuração
  válida, a publicação falha antes do `POST` (seção 3.4).
- Em domínio com tabela de medidas (seção 3.5), o anúncio leva `GENDER`, `SIZE`, `SIZE_GRID_ID` e
  `SIZE_GRID_ROW_ID`; sem tabela ou linha correspondente, a publicação falha antes do `POST`, com
  mensagem clara.
- Erros do Mercado Livre são mostrados ao operador com a mensagem das causas `error`; *warnings* não
  bloqueiam (seção 3.6).
- Os testes reais usam **usuário de teste** (o Mercado Livre não tem sandbox), com título "Item de Teste
  – Por favor, NÃO OFERTAR!", categoria "Outros" e nunca `gold`/`gold_premium`.

## 10. Conformidade constitucional

Implementa a porta `MarketplaceConnectorPort` definida em 011 (princípio VI — integrações
externas abstraídas): nenhuma outra camada do sistema conhece os detalhes da API do Mercado
Livre. Credenciais OAuth seguem a mesma criptografia reversível de 011, seção 3 (princípio
VII), só mudando o conteúdo serializado (seção 2.1). Nenhum worker/fila nova é introduzido
(princípio V, seção 2.3) — renovação de token é sempre parte do fluxo síncrono da operação, e a
trava por conta (seção 2.3) usa o próprio documento da conta, sem Redis nem fila. Encerrar um
anúncio é, como publicar, uma ação explícita do operador (princípio II) — nunca automática
(seção 7 e 011, seção 4.7).
Categorização automática sem confirmação manual (seção 4) é uma decisão deliberada de
simplicidade (princípio V), documentada como reavaliável, não uma omissão.
