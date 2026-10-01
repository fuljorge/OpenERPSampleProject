# Spec 011 — Integração com Marketplaces (Camada de Conectores)

**Domínio:** Marketplace Integration
**Fase:** 3 — Marketplaces
**Status:** Draft
**Depende de:** [001-autenticacao](../001-autenticacao/spec.md),
[002-usuarios](../002-usuarios/spec.md),
[005-produtos-cadastro-manual](../005-produtos-cadastro-manual/spec.md),
[008-auditoria](../008-auditoria/spec.md)

## 1. Visão geral

Publicar peças já cadastradas no ERP diretamente em marketplaces externos (Mercado Livre,
Shopee, eBay, ...), a partir dos dados já existentes no produto — sem retrabalho de digitação
pelo operador e sem re-fotografar a peça. O operador pode ter mais de uma conta/loja
cadastrada no mesmo marketplace (ex.: duas lojas diferentes no Mercado Livre) e publicar a
mesma peça em mais de uma delas, de forma independente.

Fonte: `Especificação Funcional e Técnica — ERP SAMPLE para Brechó.md`, seções 79–81 (v1.6).
Esta spec formaliza aquele desenho como contrato de implementação; em caso de conflito, esta
spec prevalece (constituição, seção 6).

Esta spec define a **camada de conectores** (porta comum + cadastro de contas + regras de
publicação) e o contrato que todo adapter concreto de marketplace deve seguir. A implementação
de cada conector específico (autenticação real do Mercado Livre, taxonomia de categorias da
Shopee etc.) é **fora de escopo** desta spec — vira uma spec própria por marketplace, seguindo
o roadmap da seção 5.

## 2. Contas de marketplace (cadastro multi-loja)

### 2.1 Modelo de dados

Collection `marketplace_accounts`:

```json
{
  "_id": "ObjectId",
  "marketplace": "mercado_livre",
  "label": "Loja Demo - Loja 1",
  "credential": "<opaco, sempre criptografado — seção 3>",
  "connectionStatus": "connected",
  "active": true,
  "createdBy": "ObjectId",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

- `marketplace`: mesmo enum usado em `products.marketplaces[].marketplace` (seção 4.2) —
  `mercado_livre | shopee | ebay | ...` (roadmap de valores válidos: seção 5).
- `label`: apelido de uso **interno** do ERP, escolhido pelo operador (ex.: "OpenERP Sample -
  Loja 1"), usado no seletor de conta (seção 4.3) e no selo de publicação do produto — **nunca
  enviado ao marketplace**.
- `credential`: API key, client secret e/ou token OAuth/refresh token exigidos pelo método de
  autenticação daquele marketplace, armazenados de forma opaca e criptografada (seção 3) — o
  formato exato depende do conector concreto (fora de escopo aqui).
- `connectionStatus`: `connected | disconnected | error | expired` — refletido na UI de
  "Contas de marketplace"; atualizado pelo conector a cada tentativa de autenticação.
- `active`: exclusão lógica (constituição, princípio VIII) — desativar uma conta não afeta
  publicações já existentes (seção 2.3). Depois de desativada, a conta pode ser **apagada** pelo
  admin (seção 2.2.2, ADR-022).

### 2.2 API

```
GET    /api/marketplace-accounts
POST   /api/marketplace-accounts
PATCH  /api/marketplace-accounts/:id
PATCH  /api/marketplace-accounts/:id/status
POST   /api/marketplace-accounts/:id/disconnect     (seção 2.2.2)
DELETE /api/marketplace-accounts/:id                (seção 2.2.2)
```

**Todas** restritas a `role = admin` — inclusive `GET` (leitura). Esta é uma exceção
deliberada à regra geral da constituição (seção 3: "consulta aceita todos os perfis
autenticados") — justificada pela sensibilidade da credencial armazenada: mesmo mascarada
(seção 3), nem `operator` nem `viewer` devem ter qualquer visibilidade sobre contas de
marketplace cadastradas.

`GET`/`PATCH .../:id` **nunca** retornam o valor de `credential` em texto completo — resposta
substitui por um valor mascarado (`credentialPreview`, ex.: `"****4a2f"`) e `connectionStatus`.
`POST`/`PATCH .../:id` aceitam um novo valor de credencial em texto puro **apenas na
requisição** (nunca no `GET` de volta) — trocar a credencial sempre substitui o valor anterior
por inteiro; não existe edição parcial de uma credencial já salva.

### 2.2.2 Ciclo de vida da conta: Desconectar → Desativar → Apagar

Remover uma conta segue **sempre** três passos, nesta ordem — o backend impõe a ordem (não é só
convenção de tela):

```
Desconectar ──▶ Desativar ──▶ Apagar
(connectionStatus    (active = false,     (remoção física do
 = disconnected)      exclusão lógica)     documento — irreversível)
```

| Passo | Endpoint | Pré-condição | Efeito |
|---|---|---|---|
| **Desconectar** | `POST /:id/disconnect` | nenhuma (vale de qualquer estado) | `connectionStatus = disconnected`. Para o Mercado Livre, **descarta `access_token`, `refresh_token`, `expires_at` e `user_id`** e mantém só Client ID/Secret (a conta pode ser reconectada pelo OAuth, spec 012, seção 2.2); um OAuth em andamento (`state`) é cancelado. Auditoria `MARKETPLACE_ACCOUNT_DISCONNECT`. |
| **Desativar** | `PATCH /:id/status {active:false}` | `connectionStatus = disconnected` — senão `409` "Desconecte a conta antes de desativá-la." | `active = false` (como antes). |
| **Apagar** | `DELETE /:id` | `connectionStatus = disconnected` **e** `active = false` — senão `409` indicando o passo que falta | Remove o documento e, com ele, a credencial cifrada. Auditoria `MARKETPLACE_ACCOUNT_DELETE` (marketplace e apelido, nunca a credencial). |

- **Reativar** (`active = true`) continua permitido a qualquer momento; a conta volta
  `disconnected` e precisa ser reconectada.
- **Publicações existentes não são afetadas** ao apagar: cada entrada de `products.marketplaces[]`
  guarda `conta_id` e `conta_apelido` (seção 4.2), então o selo continua correto e o anúncio segue
  no marketplace. O que se perde é poder republicar, retentar **ou encerrar** por aquela conta —
  tentar isso responde "Conta de marketplace não encontrada".
- **Aviso de anúncios no ar (não bloqueia).** Como encerrar um anúncio exige a conta ativa e
  conectada (seção 4.7), o passo certo *antes* de Desconectar é encerrar os anúncios dela. A tela
  de contas mostra, por conta, quantos anúncios `publicado` a usam (`publishedListingsCount`,
  contado em `products.marketplaces[]` e devolvido na resposta de conta), e a confirmação de
  **Desconectar** e a de **Apagar** repetem esse número e lembram de encerrá-los antes. Só avisa,
  não bloqueia: bloquear travaria contas sem tokens (que não conseguem mais encerrar pela API);
  nesse caso o admin encerra o anúncio direto no marketplace. Ver o adendo do ADR-022.
- "Desconectar" é local ao ERP: **não revoga** a autorização no Mercado Livre (isso se faz na conta
  do vendedor, em "Aplicações conectadas"). Os tokens descartados deixam de existir no ERP, e o
  `refresh_token` de uso único, sem uso, expira sozinho.
- Apagar é a **única remoção física** do sistema (ADR-022): justificada porque o registro guarda
  segredos que não devem permanecer no banco depois que o admin decidiu descartá-los. A trilha de
  auditoria (princípio IX) continua registrando quem apagou o quê e quando.
- Só `role = admin`, como toda esta API (seção 2.2). Tela: a coluna "Ações" mostra o **próximo
  passo válido** (Desconectar, depois Desativar, depois Apagar), e "Desconectar" e "Apagar" pedem
  confirmação.

### 2.2.1 Interface de cadastro — um campo por informação da credencial

`credential` é uma única string opaca na **API e no armazenamento** (seção 2.1) — mas isso não
significa que a **tela** de cadastro deva ser um único campo de texto genérico. O que compõe a
credencial de um marketplace é definido por sua própria spec de conector (012+): quando um
conector define um formato estruturado (ex.: Mercado Livre — OAuth 2.0: client ID,
client secret, access token e refresh token, spec 012, seção 2.1), a tela de "Contas de marketplace" exibe
**um campo de formulário por informação**, em vez de pedir que o admin monte/cole um blob
manualmente. O frontend monta a string única a partir desses campos antes de enviar — a API
continua recebendo (e o backend continua tratando) `credential` como um valor opaco, sem
mudança de schema no backend.

```text
Marketplace sem spec própria ainda (Shopee, eBay — seção 5)
        ↓
Formulário mostra 1 campo genérico: "Credencial"

Marketplace com credencial estruturada (Mercado Livre — spec 012)
        ↓
Formulário mostra 1 campo por informação: "Client ID", "Client Secret"
(Access/Refresh Token NÃO são digitados — vêm do OAuth, spec 012 seção 2.2;
o botão de criar só libera após o teste de integração, spec 012 seção 2.4)
        ↓
Frontend monta o valor único (JSON serializado, spec 012 seção 2.1) e
envia como credential — API não muda
```

Regras que valem para qualquer conjunto de campos:

- **Criação**: todos os campos daquele marketplace são obrigatórios.
- **Edição**: ou **todos** os campos são preenchidos (substitui a credencial inteira — seção
  2.2), ou **todos** ficam em branco (mantém a credencial atual) — nunca uma mistura, porque
  um valor estruturado incompleto (ex.: só o `access_token` novo, sem o `refresh_token`
  correspondente) ficaria inconsistente.
- Nenhum campo de credencial é pré-preenchido na edição — mesmo princípio de "nunca exibir a
  credencial completa de volta" (seção 3), agora aplicado por campo.

### 2.3 Regras de negócio

- É permitido cadastrar quantas contas o operador precisar, inclusive várias do mesmo
  marketplace.
- Cada conta é independente: falha de credencial numa conta não afeta as demais, nem
  publicações já feitas através delas.
- Desativar uma conta (`active = false`) não remove nem pausa anúncios já publicados através
  dela — eles continuam ativos no marketplace. Desativar só impede novas publicações usando
  essa conta (seção 4.3); publicações já existentes continuam visíveis normalmente no produto
  (seção 4.2), com a conta identificada como inativa. Para tirá-los do ar, **encerre-os antes**
  (seção 4.7): encerrar exige a conta ativa e conectada.

## 3. Segurança das credenciais

Credenciais de marketplace são um alvo sensível — mas, ao contrário de senha (constituição,
princípio VII), o sistema precisa recuperar o valor original para autenticar com a API do
marketplace, então a proteção é **criptografia reversível**, não hash.

- `credential` é armazenado **criptografado em repouso**, nunca em texto puro (nem em
  backups). A chave-mestra (que protege as chaves de criptografia — seção 3.1) fica fora do
  banco, em variável de ambiente (mesmo princípio já exigido para outros secrets —
  constituição, princípio VII), nunca junto com os dados criptografados.
- O valor completo de `credential` nunca é exibido de volta em nenhuma tela ou resposta de API
  — nem para `admin` (seção 2.2).
- Credenciais (mascaradas ou não) nunca aparecem em logs de aplicação, logs de erro ou
  mensagens de exceção — falha de autenticação com o marketplace (seção 4.3) registra o tipo
  de erro, nunca o valor usado.
- Toda comunicação com a API de um marketplace usa HTTPS, validando o certificado do servidor
  remoto (sem desabilitar verificação de TLS).
- Respostas/webhooks recebidos de um marketplace têm sua autenticidade validada (assinatura,
  segredo compartilhado ou mecanismo equivalente oferecido por aquele marketplace) antes de
  qualquer dado ser aceito — nunca confiar apenas na origem (IP/header) da requisição
  (proteção contra spoofing).
- `/api/marketplace-accounts` tem rate limit (mesmo princípio já exigido em `/auth/login`,
  constituição princípio VII), para dificultar força bruta/enumeração.
- Todo conector trata a resposta do marketplace como entrada não confiável — validada por Zod
  antes de ser gravada no produto (seção 4.2), do mesmo jeito que qualquer entrada externa
  (constituição, princípio IV).
- Toda operação sobre uma conta de marketplace — criar, editar, desativar e **visualizar**
  (mesmo mascarada) — é auditada: `MARKETPLACE_ACCOUNT_CREATE`, `MARKETPLACE_ACCOUNT_UPDATE`,
  `MARKETPLACE_ACCOUNT_DISABLE`, `MARKETPLACE_ACCOUNT_VIEW` (estende a lista mínima de
  [008-auditoria](../008-auditoria/spec.md), seção 3).

### 3.1 Chave de criptografia e rotação manual pelo admin

A chave que cifra `credential` precisa poder ser trocada sem perder nenhuma conta cadastrada
(vazamento suspeito, troca de responsável, política de segurança) **e** sem exigir acesso à
infraestrutura: o administrador rotaciona pela própria tela. Decisão e alternativas descartadas:
[ADR-021](../../memory/decisions.md).

**Envelope encryption** — duas camadas de chave:

```text
chave-mestra (variável de ambiente, fora do banco)
      ↓ cifra
chaves de dados versionadas (k1, k2, ... — no banco, sempre cifradas pela chave-mestra)
      ↓ cifram
credenciais das contas (`credential` = "k2:{iv}:{authTag}:{dados}")
```

- **Chave-mestra**: `MARKETPLACE_CREDENTIAL_MASTER_KEY` (32 bytes, base64), definida uma vez por
  ambiente. É o único segredo que fica fora do banco; nunca é exibida nem trocada pela tela.
- **Chaves de dados**: geradas pela aplicação (ninguém gera nem cola chave à mão); a **primeira
  é criada sozinha** no primeiro uso. A ativa é sempre a de maior versão. Cada valor cifrado
  carrega o id da chave que o cifrou. O id da chave é dado autenticado (AAD) ao embrulhá-la: uma
  chave copiada para outro registro não abre.
- **Um vazamento do banco isolado não expõe nada**: as chaves de dados só existem no banco
  cifradas pela chave-mestra.

**Rotação manual — botão "Rotacionar chave de criptografia"** na tela de "Contas de marketplace"
(restrito a `admin`; nunca automática, nunca agendada):

```text
Admin clica → tela pede confirmação (mostra quantas contas serão re-cifradas)
      ↓
POST /api/marketplace-accounts/rotate-key  (admin, rate limit 5/min)
      ↓
1. cria a próxima versão (k{n+1}) — passa a ser a ativa na mesma operação
2. re-cifra cada conta, decifrando com a chave antiga e cifrando com a nova
3. registra MARKETPLACE_CREDENTIAL_KEY_ROTATE (admin responsável, chave anterior/nova, contagens)
      ↓
Tela mostra: k1 → k2, quantas contas foram re-cifradas e quais falharam
```

- **Chaves antigas nunca são apagadas** — só decifram. Por isso nenhuma credencial se perde
  mesmo que uma conta falhe ao ser re-cifrada (fica legível na chave anterior e é reportada; uma
  nova rotação tenta de novo). O mesmo vale para uma conta cifrada por outra instância da
  aplicação durante a rotação: a chave é lida do banco a cada operação, sem cache.
- Duas rotações simultâneas não criam a mesma versão: a segunda recebe `409` ("outra rotação em
  andamento"), sem transação.
- A gravação é condicional ao valor lido: uma conta editada por um admin durante a rotação nunca
  é sobrescrita.
- `GET /api/marketplace-accounts/encryption-key` (admin) devolve só metadados — id/versão/data
  da chave ativa e quantas contas há em cada chave. **Nunca** material de chave.
- A tela exibe o mesmo estado ("Chave ativa: k2 (versão 2)… Contas por chave: k2: 3").

**Chave-mestra**: perdê-la ou trocá-la torna todas as chaves de dados ilegíveis (as contas precisam
ser recadastradas) — guardar cópia fora do Azure e usar valores diferentes por ambiente. Sua
própria rotação (re-embrulhar as chaves de dados) é rara e **fora de escopo** desta spec.

## 4. Publicação de produto no marketplace

### 4.1 Camada de conectores (porta comum)

Uma interface comum ("porta") que todo marketplace implementa, e um adaptador concreto por
marketplace — mesmo princípio arquitetural já usado para os demais provedores externos (IA,
imagens — constituição, princípio VI). Isso permite adicionar um novo marketplace um a um, sem
alterar os módulos já existentes (Produtos, SKU, Estoque, Preço, Imagens) — só a implementação
concreta daquele conector.

```text
Produto (ERP)
    ↓
Camada de conectores (porta comum)
    ↓                    ↓                    ↓
Conector             Conector             Conector
Mercado Livre        Shopee               eBay
    ↓                    ↓                    ↓
API do                API do               API do
Mercado Livre         Shopee               eBay
```

A porta comum (`MarketplaceConnectorPort`, nome definitivo cabe ao plan.md) expõe, no mínimo,
duas operações:

```text
publish(product, account, categoryId?, listingTypeId?) → { id_anuncio, url_anuncio }   cria o
                                    anúncio, ou o atualiza se a entrada já tem id_anuncio (4.5)
close(listing, account)                              → { encerrado }   encerra o anúncio (4.7)
```

Ambas recebem a credencial já decifrada e devolvem, junto do resultado **e também do erro**, uma
`updatedCredential` opcional — o novo par de tokens quando o conector precisou renová-lo (OAuth
com refresh token de uso único, spec 012, seção 2.3). Quem persiste é o serviço, nunca o
adaptador. A porta não concede nenhuma capacidade de function/tool calling ou ação autônoma além
de criar, atualizar e encerrar um anúncio — mesmo espírito de superfície mínima já aplicado ao
adapter de IA ([006-produtos-cadastro-ia](../006-produtos-cadastro-ia/spec.md), seção 8.2,
defesa E).

`categoryId` é a categoria do marketplace **já escolhida antes de chamar a porta** — nenhum
adaptador decide sozinho em qual categoria publicar (ADR-025). Quem resolve esse valor (predição
automática, revisão humana, ou os dois) é decisão de cada conector/spec própria; a porta só
carrega o resultado. Hoje só o Mercado Livre usa o campo (spec 012, seção 4: preditor sugere,
operador confirma numa tela de revisão antes de publicar); um conector futuro que não precise de
categorização explícita o ignora.

`listingTypeId` segue o mesmo espírito (ADR-026): o tipo/plano de anúncio (custo × exposição) já
escolhido pelo operador antes de chamar a porta — nunca uma variável de ambiente fixa nem uma
decisão automática do adaptador. Hoje só o Mercado Livre usa o campo (spec 012, seção 3.2: caixa
de seleção na mesma tela de revisão da categoria, do menor custo para o maior).

### 4.2 Modelo de dados — `products.marketplaces`

Estende o modelo de produto ([005-produtos-cadastro-manual](../005-produtos-cadastro-manual/spec.md),
seção 2): o campo `marketplaces` deixa de ser um objeto fixo com uma entrada por nome de
marketplace e passa a ser uma **lista de publicações**, uma por combinação
(marketplace + conta) — permitindo zero, uma ou várias publicações por peça, inclusive mais de
uma no mesmo marketplace (desde que em contas diferentes):

```json
"marketplaces": [
  {
    "marketplace": "mercado_livre",
    "conta_id": "ObjectId",
    "conta_apelido": "Loja Demo - Loja 1",
    "status": "publicado",
    "id_anuncio": "MLB123456789",
    "url_anuncio": "https://produto.mercadolivre.com.br/MLB-123456789",
    "publicado_em": "ISODate",
    "encerrado_em": null,
    "erro": null
  }
]
```

`conta_id` referencia `marketplace_accounts._id` (seção 2.1). Não é permitido mais de um item
com a mesma combinação (`marketplace`, `conta_id`) — republicar sobre uma publicação existente
atualiza o item, nunca duplica.

`status`: `nao_publicado | publicado | erro | encerrado`. `encerrado` (seção 4.7) preenche
`encerrado_em`; o anúncio deixou de estar à venda naquele marketplace. `erro` preenchido junto de
`status = publicado` significa "no ar, com pendência" (ex.: descrição não enviada — spec 012,
seção 3.1); junto de `status = erro`, a última tentativa falhou.

### 4.3 Fluxo de publicação

Botão **"Publicar no [Marketplace]"** na tela de edição do produto (a tela do SKU):

```text
Operador abre o produto
        ↓
Escolhe o marketplace (ex.: Mercado Livre)
        ↓
Escolhe a conta/loja cadastrada naquele marketplace — pulado automaticamente
se só houver uma conta ativa cadastrada
        ↓
Clica em "Publicar no Mercado Livre"
        ↓
Sistema valida se o produto tem dados mínimos completos (seção 4.6)
        ↓
[passo específico do conector, se ele precisar — ex.: revisão de categoria do
Mercado Livre, spec 012 seção 4 (ADR-025); um conector sem esse passo pula direto]
        ↓
Sistema monta o anúncio a partir dos dados do produto (seção 4.4)
        ↓
Conector autentica com o marketplace usando a credencial da conta escolhida (seção 3)
        ↓
Conector cria o anúncio via API do marketplace
        ↓
Sistema grava id/URL do anúncio e status "publicado" numa entrada de
`marketplaces` (marketplace + conta — seção 4.2)
        ↓
Tela do produto exibe selo "Publicado no Mercado Livre (<conta>)" com link pro anúncio
```

Publicar a mesma peça numa segunda conta do mesmo marketplace repete esse fluxo do início,
escolhendo a outra conta — as duas publicações ficam registradas lado a lado, cada uma com seu
próprio id/URL/status de anúncio.

O passo entre colchetes é opcional na porta comum e existe hoje só para o Mercado Livre — a
revisão de categoria (spec 012, seção 4; ADR-025) roda **sempre**, em toda publicação, incluindo
retentativas e republicações, não só na primeira vez.

### 4.4 Dados enviados ao marketplace

A fonte é sempre o modelo de produto já existente (005) — nenhum campo novo é digitado
especificamente para a publicação:

```text
Nome
Descrição
Categoria (mapeada para a taxonomia do marketplace, quando aplicável — o Mercado Livre exige
confirmação do operador antes de publicar, spec 012 seção 4, ADR-025)
Preço de venda
Condição (novo/seminovo/usado, mapeada para as opções do marketplace)
Características relevantes (marca, tamanho, cor, material)
Fotos da galeria (a foto de capa é usada como imagem principal do anúncio)
```

### 4.5 API

```
POST   /api/products/:id/marketplace-listings
POST   /api/products/:id/marketplace-listings/close      (seção 4.7)
```

Corpo: `{ "marketplace": "mercado_livre", "accountId": "...", "categoryId": "...", "listingTypeId": "..." }`.
`categoryId` e `listingTypeId` são opcionais na porta comum (seção 4.1) — obrigatórios na prática
para o Mercado Livre, que os exige vindo da tela de revisão (spec 012, seções 3.2 e 4; ADR-025,
ADR-026); um conector futuro sem esse passo simplesmente os ignora. Restrito a
`role ∈ {admin, operator}` (mesma permissão de "publicar produtos" — 002-usuarios). Cria uma
nova publicação, ou **retenta** uma publicação
existente com `status = erro` para a mesma combinação (marketplace, conta) — nunca cria um
segundo item para a mesma combinação (seção 4.2). Sobre uma entrada que já tem `id_anuncio`
(`publicado`), a mesma chamada **atualiza** o anúncio ("Republicar"); sobre uma `encerrado`,
cria um anúncio novo — a regra de quando cada operação vale é do conector (spec 012, seção 3.1).

Endpoint adicional, específico do passo de revisão do Mercado Livre (spec 012, seção 4):

```
POST   /api/products/:id/marketplace-category-suggestion
```

Corpo: `{ "marketplace": "mercado_livre", "accountId": "..." }`. Devolve a sugestão do preditor
do marketplace (quando disponível) e a lista curada de categorias para o `<select>` de revisão
— nunca cria nem altera nada, só consulta. Mesma permissão da publicação.

### 4.6 Regras de negócio

- Só é possível publicar um produto com dados mínimos completos: nome, categoria, preço de
  venda e ao menos uma foto. Publicar sem isso é bloqueado, com mensagem clara sobre o que
  falta.
- Publicar um anúncio é sempre uma ação explícita do operador — nunca automática (Human in the
  Loop, constituição princípio II). Nenhum produto é publicado em qualquer marketplace sem
  essa ação direta.
- Publicar **não** altera o status do produto no ERP
  ([005](../005-produtos-cadastro-manual/spec.md#3-status-do-produto)) — publicação é uma ação
  complementar, não substitui nem antecipa o fluxo de venda local.
- Falha na publicação (erro do marketplace, credencial expirada, atributo obrigatório
  faltando etc.) nunca é silenciosa: a entrada correspondente de `marketplaces` registra o
  erro (campo `erro`), visível na tela do produto, com opção de tentar de novo. Falha numa
  conta não afeta publicações já feitas ou em andamento em outras contas.
- Publicar a mesma peça em duas contas do mesmo marketplace é permitido e **não** é tratado
  como duplicidade — cada publicação é independente.
- Cada marketplace tem sua própria metodologia de publicação — categorias próprias, atributos
  obrigatórios variáveis, regras específicas de imagem. A camada de conectores isola essa
  variação: o restante do sistema nunca precisa conhecer os detalhes de um marketplace
  específico.
- Atualizar um produto já publicado (ex.: mudar o preço) **não** sincroniza automaticamente
  com o marketplace nesta fase — o operador republica manualmente quando quiser refletir a
  mudança.
- Uma peça vendida por qualquer canal (loja física ou um dos marketplaces) continua exigindo
  baixa manual do operador no ERP
  ([005](../005-produtos-cadastro-manual/spec.md#3-status-do-produto)) — inclusive quando
  publicada em mais de uma conta/marketplace: o risco de venda duplicada entre canais existe
  até uma sincronização automática ser implementada (fora de escopo, seção 7); cada peça tem
  SKU único (constituição, princípio X). **Para reduzir esse risco**, ao marcar a peça como
  `vendido` (ou `inativo`) o ERP **avisa** que ela ainda tem anúncio(s) `publicado` e oferece
  "Encerrar anúncios" (seção 4.7) — explícito e com confirmação, nunca automático.
- Toda publicação bem-sucedida ou falha gera auditoria (`PRODUCT_PUBLISH`), e todo encerramento,
  bem-sucedido ou não, também (`PRODUCT_UNPUBLISH`) — ver
  [008-auditoria](../008-auditoria/spec.md).

### 4.7 Encerrar anúncio

Tira do ar um anúncio `publicado`, sem apagar o registro do ERP. Botão **"Encerrar anúncio"** ao
lado do selo de cada publicação na tela do produto, com confirmação ("O anúncio deixará de estar à
venda no Mercado Livre. Para vender de novo será preciso publicar outra vez.").

```text
Operador clica em "Encerrar anúncio" numa publicação `publicado`
        ↓
Sistema confirma que a conta da publicação está ativa e conectada
        ↓
Conector encerra o anúncio via API do marketplace (`close`)
        ↓
Sistema grava `status = encerrado` e `encerrado_em`
        ↓
Tela do produto passa a exibir "Anúncio encerrado em <data>" (sem o selo Publicado)
```

- **API:** `POST /api/products/:id/marketplace-listings/close`, corpo `{ marketplace, accountId }`.
  `role ∈ {admin, operator}`, como publicar. Auditoria `PRODUCT_UNPUBLISH` (marketplace,
  `accountId`, `id_anuncio`, sucesso/erro — nunca credencial).
- **Só encerra o que está `publicado`:** entrada `nao_publicado`, `erro` sem anúncio ou já
  `encerrado` → `409`.
- **Conta precisa estar ativa e conectada**, porque encerrar exige a credencial: conta inativa,
  `disconnected` ou `expired` → `409` com o passo que resolve (ativar / conectar), sem chamar o
  marketplace. Se a conta já foi apagada, o encerramento pela API não é mais possível — o
  anúncio se encerra direto no marketplace (ver 2.2.2).
- **Falha nunca é silenciosa:** a entrada segue `publicado`, com `erro` = "Falha ao encerrar:
  <motivo>" e opção de tentar de novo.
- **Não altera o status do produto** no ERP (005) — como publicar (seção 4.6). Marcar a peça como
  vendida é uma ação separada; o aviso descrito na seção 4.6 liga as duas.
- **Republicar depois de encerrar** é permitido e cria um anúncio novo no marketplace (spec 012,
  seção 3.1); o `id_anuncio` antigo fica apenas na auditoria.
- **Excluir** o anúncio de vez, pausar/reativar e encerrar em lote estão fora de escopo (seção 7).

## 5. Roadmap de conectores (ordem de implementação)

A implementação segue estritamente esta ordem, um conector por vez — nenhum conector novo é
iniciado especulativamente antes do anterior estar completo e validado:

```text
1. Mercado Livre
2. Shopee
3. eBay
4. Demais marketplaces (ex.: Shein, Amazon, Enjoei, OLX) — avaliados um a um,
   conforme demanda real
```

Cada novo conector deve, obrigatoriamente:

- Implementar a mesma porta comum (seção 4.1) dos conectores anteriores.
- Não exigir nenhuma alteração nos módulos de Produtos, SKU, Estoque, Preço ou Imagens.
- Documentar sua própria metodologia de publicação (autenticação, taxonomia de categorias,
  atributos obrigatórios, regras de imagem) como parte de sua **própria spec** (`012-...` em
  diante, uma por conector).
- Suportar múltiplas contas desde o início (seção 2) — não é uma evolução separada por
  marketplace, é parte da porta comum que todo conector implementa.
- Ser validado de ponta a ponta (publicação real de pelo menos uma peça de teste) antes de ser
  considerado concluído.

## 6. Critérios de aceite

- Publicar um produto com dados mínimos completos numa conta cadastrada cria uma entrada em
  `marketplaces` com `status = publicado`, `id_anuncio` e `url_anuncio` preenchidos.
- Publicar um produto sem preço de venda ou sem foto é bloqueado, com mensagem indicando o(s)
  campo(s) faltante(s) — nenhuma chamada ao conector é feita.
- Publicar a mesma peça em duas contas diferentes do mesmo marketplace resulta em duas
  entradas independentes em `marketplaces`, cada uma com seu próprio `id_anuncio`/`status`.
- Uma falha do conector (ex.: credencial expirada) grava `status = erro` e `erro` preenchido
  na entrada correspondente, sem afetar outras entradas do mesmo produto.
- Um usuário `viewer` recebe `403` ao tentar publicar (`POST /api/products/:id/marketplace-listings`).
- Um usuário `operator` recebe `403` em qualquer rota de `/api/marketplace-accounts` (criar,
  editar, desativar **ou consultar**) — só `admin` acessa.
- `GET /api/marketplace-accounts` nunca retorna o valor completo de `credential` em nenhuma
  resposta, em nenhum perfil.
- Desativar uma conta de marketplace não altera nem remove publicações já existentes feitas
  através dela.
- Encerrar um anúncio `publicado` (seção 4.7) grava `status = encerrado` e `encerrado_em`,
  audita `PRODUCT_UNPUBLISH` e não altera o status do produto nem as demais publicações.
- Encerrar exige `admin` ou `operator` (`viewer` recebe `403`) e é rejeitado com `409`, sem chamar
  o conector, quando a entrada não está `publicado` ou a conta está inativa/desconectada/expirada.
- Falha ao encerrar mantém `status = publicado`, com `erro` preenchido e nova tentativa possível.
- Publicar de novo uma entrada `encerrado` cria um anúncio novo, sem duplicar a entrada.
- Marcar uma peça como `vendido`/`inativo` que tenha anúncio `publicado` exibe o aviso e a opção
  "Encerrar anúncios"; nada é encerrado sem a confirmação do operador.
- A resposta de conta traz `publishedListingsCount`, e as confirmações de Desconectar e Apagar o
  exibem quando for maior que zero (sem bloquear).

## 7. Fora de escopo

```text
Implementação concreta de qualquer conector (Mercado Livre, Shopee, eBay, ...) —
vira spec própria por marketplace (seção 5)

Importação de pedidos feitos no marketplace de volta para o ERP

Baixa automática de estoque entre canais (cross-channel)

Sincronização automática de preço/estoque após a publicação inicial

Atualização automática de um anúncio já publicado

Encerramento automático do anúncio quando a peça é marcada como vendida — a tela só avisa e
oferece a ação (seção 4.6/4.7); a decisão é do operador

Excluir o anúncio de vez, pausar/reativar e encerrar em lote (várias peças ou contas de uma vez)

Suporte a variações (múltiplos tamanhos/cores por anúncio)

Precificação diferenciada por marketplace

Publicação em lote automática em todas as contas de um marketplace de uma vez —
o operador escolhe e confirma uma conta por vez, explicitamente

Sincronizar preço/estoque entre contas do mesmo marketplace automaticamente

Transferir ou mesclar publicações entre contas

Limite de contas cadastráveis por marketplace (nenhum é imposto nesta fase)
```

Esses itens seguem o mesmo roadmap por fases (documento fonte, seção 75) e devem ser
detalhados quando cada conector específico avançar de fase.

## 8. Conformidade constitucional

Implementa o princípio VI (integrações externas abstraídas — camada de conectores, porta
comum) e o princípio II (Human in the Loop — publicação é sempre uma ação explícita do
operador, nunca automática). A seção 3 (segurança das credenciais) implementa o princípio VII
para o caso específico de segredos reversíveis (diferente de senha, que usa hash — princípio
VII cobre ambos os casos). Contas de marketplace usam exclusão lógica (`active = false`,
princípio VIII) e, **só depois de desconectadas e desativadas**, podem ser apagadas fisicamente
pelo admin (seção 2.2.2; ADR-022 — o princípio VIII proíbe remoção física "por padrão" de
usuários e produtos, e a exceção aqui é explícita, ordenada e auditada). Toda operação sensível
desta spec — cadastro/edição/desconexão/desativação/exclusão/visualização de conta, publicação
e encerramento de anúncio — gera auditoria (princípio IX,
[008-auditoria](../008-auditoria/spec.md)). A restrição de `GET /api/marketplace-accounts` a
`role = admin` (seção 2.2) é uma exceção explícita à regra geral de RBAC da constituição
(seção 3), justificada pela sensibilidade da credencial armazenada.
