---
name: decisions
description: Registro de decisões arquiteturais (ADR) do OpenERP Sample — histórico de escolhas técnicas que desviam ou detalham o documento fonte original.
---

# Registro de Decisões Arquiteturais — OpenERP Sample

Este documento mantém o histórico de decisões técnicas relevantes tomadas ao longo do
projeto, no formato ADR (*Architecture Decision Record*). Fica separado de
[constitution.md](constitution.md) para que a constituição continue enxuta e focada em
princípios estáveis, enquanto este arquivo cresce com o tempo.

Toda decisão aqui registrada que altere a stack tecnológica da seção 2 da constituição deve
também atualizar a tabela correspondente em `constitution.md`. Decisões que desviam do
documento fonte original (`Especificação Funcional e Técnica — OpenERP Sample.md`)
devem apontar para a versão do documento fonte que reflete a mudança, quando existir (ver
`Especificação Funcional e Técnica — OpenERP Sample (v1.1).md`).

## Convenção

Cada ADR segue o formato:

```
## ADR-NNN — Título

**Status:** Proposta | Aceita | Superada por ADR-XXX
**Data:** AAAA-MM-DD
**Specs afetadas:** lista de specs em specs/

### Contexto
### Decisão
### Consequências
```

---

## ADR-001 — Provedor de armazenamento de imagens: Azure Blob Storage

**Status:** Aceita
**Data:** 2026-08-22
**Specs afetadas:** [007-imagens](../specs/007-imagens/spec.md)

### Contexto

O documento fonte original (v1.0, seção 4.4) sugeria **Cloudinary** como provedor
preferencial de armazenamento de imagens, com AWS S3 e Cloudflare R2 como alternativas
futuras. O time do projeto decidiu adotar diretamente **Azure Blob Storage** como provedor
de imagens desde o MVP.

### Decisão

Substituir Cloudinary por Azure Blob Storage em todas as referências de stack e
implementação:

- `memory/constitution.md`, seção 2 (tabela de stack).
- [specs/007-imagens/spec.md](../specs/007-imagens/spec.md): seção de armazenamento
  reescrita (container privado, acesso via URL pública de blob ou SAS token, upload/remoção
  exclusivos do backend).
- [specs/007-imagens/plan.md](../specs/007-imagens/plan.md): adapter
  `backend/src/plugins/images/azure-blob.adapter.ts` usando `@azure/storage-blob`.
- [specs/007-imagens/tasks.md](../specs/007-imagens/tasks.md): tarefa de implementação do
  adapter e de configuração de dependência/variáveis de ambiente.
- `backend/.env.example`: `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` /
  `CLOUDINARY_API_SECRET` → `AZURE_STORAGE_CONNECTION_STRING` / `AZURE_STORAGE_CONTAINER_NAME`.
- `backend/package.json`: dependência `@azure/storage-blob`.
- Nova versão do documento fonte:
  `Especificação Funcional e Técnica — OpenERP Sample (v1.1).md` (documento original
  v1.0 preservado sem alterações, como referência histórica).

### Consequências

- **Sem impacto em regras de negócio.** A troca foi viabilizada inteiramente pela abstração
  de provedor de imagens exigida pela constituição, princípio VI (`ImageProviderPort`): só o
  adapter concreto muda. O contrato (`upload`/`remove`) e o modelo de dados persistido em
  `products.imagens` (id, URL, metadados, ordem, tipo) permanecem idênticos.
- ~~Decisão em aberto sobre leitura pública vs. SAS token~~ e topologia de containers —
  resolvidas pelo [ADR-003](#adr-003--topologia-do-azure-blob-storage-1-storage-account-leitura-pública-a-nível-de-blob).
- Nenhuma outra spec ou domínio (categorias, SKU, produtos, IA) precisou de alteração.

---

## ADR-002 — Adapter de IA genérico compatível com a API OpenAI

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [006-produtos-cadastro-ia](../specs/006-produtos-cadastro-ia/spec.md)

### Contexto

`plan.md` de 006 deixava em aberto a escolha do provedor de IA multimodal concreto
(`<provider>.adapter.ts`), sem fixar um vendor. Em vez de acoplar a implementação a um SDK
proprietário de um único provedor, foi adotado o SDK oficial `openai` (Node), que permite
apontar `baseURL` para qualquer endpoint compatível com o formato OpenAI Chat Completions
(texto + imagem → JSON estruturado via `response_format: json_object`).

### Decisão

Implementar `backend/src/plugins/ai/openai-compatible.adapter.ts` como a implementação
concreta de `AiProviderPort` ([ai-provider.port.ts](../backend/src/plugins/ai/ai-provider.port.ts)),
configurável inteiramente por variáveis de ambiente — nenhuma troca de código necessária para
trocar de provedor:

- `AI_API_KEY` — chave do provedor.
- `AI_BASE_URL` — endpoint da API; vazio usa a OpenAI oficial
  (`https://api.openai.com/v1`); pode apontar para qualquer gateway/servidor compatível
  (OpenRouter, Groq, Together AI, vLLM, Ollama, LM Studio, Azure OpenAI em modo compatível
  etc.).
- `AI_MODEL` — identificador do modelo no provedor escolhido.

`backend/.env.example` e `backend/package.json` (dependência `openai`) atualizados de acordo.
O prompt de sistema padrão do adapter já reforça o princípio I da constituição (campo
indeterminável ⇒ `null`, nunca valor inventado); a validação estrutural via Zod continua
ocorrendo em `services/ai-intake.service.ts` (T002/T006 de
[006/tasks.md](../specs/006-produtos-cadastro-ia/tasks.md)), nunca no adapter.

**Validado contra o endpoint real configurado em `.env`** (gateway interno
`llm.example.com`, modelo `qwen/qwen3.8-27b`, com suporte a visão): a chamada de
texto simples e a chamada com imagem (`image_url` em base64) funcionam. Descoberta relevante:
esse gateway rejeita `response_format: {type: "json_object"}` com `400` (só aceita
`json_schema` ou `text`) — divergência real de "compatibilidade OpenAI" entre provedores. Por
isso o adapter **não** envia `response_format` por padrão; a saída JSON é garantida só via
instrução no prompt de sistema + parsing defensivo (remove cercas Markdown, extrai o primeiro
objeto/array JSON válido do texto). Um flag `useJsonObjectResponseFormat` no construtor permite
reativar o parâmetro para provedores que o suportam (ex.: OpenAI oficial).

### Consequências

- Resolve parcialmente o risco em aberto do `plan.md` de 006 (seção 7): o provedor concreto
  continua não fixado a um vendor específico, mas a implementação já existe e funciona com
  qualquer provedor compatível com o formato OpenAI, sem código adicional.
- **Fora do escopo desta decisão:** provedores com formato de API não compatível com OpenAI
  Chat Completions (ex.: Anthropic Claude, Google Gemini em suas APIs nativas) exigiriam um
  adapter próprio implementando o mesmo `AiProviderPort` — a abstração já suporta isso sem
  alterar `ai-intake.service.ts`.
- T001 e T005 de [006/tasks.md](../specs/006-produtos-cadastro-ia/tasks.md) foram concluídas
  antes do restante da feature (que ainda depende de 003, 004 e 005).

---

## ADR-003 — Topologia do Azure Blob Storage: 1 Storage Account, leitura pública a nível de blob

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [007-imagens](../specs/007-imagens/spec.md)

### Contexto

`plan.md` de 007 (seção 7) deixava em aberto duas decisões de implementação do Azure Blob
Storage adotado no [ADR-001](#adr-001--provedor-de-armazenamento-de-imagens-azure-blob-storage):
(1) se o container teria leitura pública a nível de blob ou seria privado com SAS token gerado
sob demanda pelo backend; (2) como isolar dev/test/prod (mesmo padrão de separação já adotado
para o MongoDB Atlas — 3 Projects/clusters distintos).

Durante o provisionamento, a Storage Account foi criada com **"Allow Blob anonymous access"
desabilitado** (padrão de segurança de contas novas no portal Azure), o que impedia configurar
qualquer container como público — resolvido habilitando essa opção a nível de conta antes de
criar os containers.

### Decisão

- **Acesso do container**: leitura pública a nível de **blob** (`Anonymous access level =
  Blob`), não a nível de container (que permitiria listar todos os blobs). URLs de blob são
  estáveis e não expiram — adequado para persistir diretamente em `products.imagens.*.url`,
  sem depender de renovação de SAS token. Upload e remoção continuam exclusivos do backend,
  autenticado via `AZURE_STORAGE_CONNECTION_STRING` (chave de acesso da conta), nunca exposta
  ao frontend.
- **Topologia**: **1 única Storage Account** (`stopenerpsample`) compartilhada entre ambientes,
  com **3 containers separados**: `product-images-dev`, `product-images-test`,
  `product-images-prod`. A `AZURE_STORAGE_CONNECTION_STRING` é a mesma nos três ambientes; só
  `AZURE_STORAGE_CONTAINER_NAME` muda. Isolamento é por container/namespace, não por
  credencial — mais simples de provisionar que 3 storage accounts, ao custo de os três
  ambientes compartilharem a mesma chave de acesso.
- `backend/.env.example` atualizado: `AZURE_STORAGE_CONTAINER_NAME` passa de `product-images`
  (genérico) para `product-images-dev` (com comentário explicando a variação por ambiente).

### Consequências

- Resolve as duas decisões em aberto do `plan.md` de 007, seção 7.
- **Validado de ponta a ponta** contra a Storage Account real (`stopenerpsample`): os 3
  containers existem, o container de dev tem `blobPublicAccess = "blob"`, e um blob de teste
  fez upload → leitura anônima via URL pública (200 OK, sem token) → remoção, com sucesso.
- **Risco aceito**: como as 3 credenciais de ambiente são idênticas (mesma Storage Account),
  um bug ou vazamento de `AZURE_STORAGE_CONNECTION_STRING` de um ambiente expõe escrita/leitura
  em todos os containers, inclusive `-prod`. Mitigação mínima: nunca versionar `.env`
  (já garantido pelo `.gitignore`) e, se o projeto crescer, migrar para 3 storage accounts ou
  para SAS delegado por ambiente — não é necessário no MVP.
- Como as URLs de blob são públicas e estáveis, qualquer pessoa que descubra a URL de uma
  imagem pode acessá-la (mas não listar nem escrever) — aceitável porque fotos de peça não são
  dado sensível (mesma justificativa já registrada no ADR-001).

---

## ADR-004 — Bootstrap do admin inicial via script de seed

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [001-autenticacao](../specs/001-autenticacao/spec.md),
[002-usuarios](../specs/002-usuarios/spec.md)

### Contexto

`POST /api/users` (002) é restrito a `role = admin`, mas `001-autenticacao` só autentica —
não cria usuários. Sem nenhum usuário na collection `users`, não há como logar pela primeira
vez nem criar o primeiro admin pela própria API (problema "ovo e galinha"). Nenhuma spec
cobria esse bootstrap. Duas opções foram consideradas: (a) script de seed manual, reexecutável
e idempotente; (b) o `server.ts` criar automaticamente um admin no boot se a collection
`users` estiver vazia.

### Decisão

Optou-se por **(a)**: `backend/src/scripts/seed-admin.ts`, rodado via `npm run seed:admin`
(não faz parte do bootstrap do Fastify em `server.ts`).

- Exige `SEED_ADMIN_EMAIL` no ambiente (erro claro se ausente) — nunca inventa um e-mail.
- `SEED_ADMIN_PASSWORD` é opcional: se ausente, gera uma senha aleatória de 12 bytes
  (`crypto.randomBytes(12).toString("base64url")`) e imprime uma única vez no console,
  seguindo a mesma ideia de "senha temporária" já prevista em 002-usuarios, seção 5.
- **Idempotente**: se já existir qualquer usuário `role = admin`, o script não faz nada e
  informa qual e-mail já existe — seguro rodar múltiplas vezes, inclusive por engano em CI.
- Usa `hashPassword()` de `services/password.service.ts` (Argon2id, T008 de
  [001/tasks.md](../specs/001-autenticacao/tasks.md)) e `connectMongo()`/`getDb()` de
  `database/mongo.client.ts` (T001) — nenhuma lógica de hashing/conexão duplicada.
- Insere diretamente na collection `users` (sem passar por um `user.repository.ts` de
  escrita, que pertence a 002-usuarios e ainda não existe) — é uma ferramenta operacional de
  bootstrap, não um endpoint da API.

### Consequências

- Rejeitada a opção (b) (auto-criação no boot): criar um admin implicitamente toda vez que a
  collection estiver vazia é mais fácil de disparar sem querer (ex.: apontar `.env` para um
  banco novo por engano em produção) e menos auditável que um comando explícito.
- **Validado contra o cluster de dev real**: rodado duas vezes — a primeira criou
  `admin@example.com` (senha temporária gerada e entregue ao usuário fora deste
  documento); a segunda, com outro e-mail, corretamente recusou criar um segundo admin.
- Mesmo padrão deve ser reaproveitado (mesmo script, apontando para o `.env` daquele
  ambiente) ao provisionar os ambientes de teste e produção mais adiante.

---

## ADR-005 — Identidade visual do frontend: paleta e tipografia inspiradas no site institucional

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** nenhuma spec específica — decisão transversal de UI, vale para toda tela
construída daqui em diante (001, 002 e futuras).

### Contexto

Nenhuma spec, a constituição ou o documento fonte definiam paleta de cores, tipografia ou
identidade visual — só "CSS Modules/Tailwind" como opção de stack (constituição, seção 2).
`LoginPage.tsx` (001) foi implementada em HTML puro sem estilo; as telas de 002-usuários
usaram Tailwind com uma paleta azul genérica, escolhida sem nenhuma referência de marca. O
usuário pediu um design inspirado na identidade visual da marca: um emblema dourado sobre
fundo bordô.

### Decisão

Extraídas por amostragem de pixel do logo real (não estimadas visualmente):

| Token | Hex | Origem |
|---|---|---|
| `wine-900` | `#3d0006` | fundo bordô da página institucional |
| `gold-400` | `#f1b233` | brilho do anel do medalhão |
| `gold-600` | `#c9891f` | tom médio das letras douradas |
| `gold-800` | `#693f09` | sombra/bronze do relevo dourado |

Escalas completas (`wine-50`...`950`, `gold-50`...`900`) interpoladas a partir desses pontos,
mais `cream-50`/`cream-100` (fundo neutro claro para telas de trabalho) — definidas em
`frontend/src/app/index.css` via `@theme` do Tailwind v4 (CSS-first, sem `tailwind.config.js`).
Tipografia: `Playfair Display` (serifada, mesmo espírito do logo) para títulos/marca via
`font-display`, `Inter` para todo o resto (formulários, tabelas) via `font-sans` — carregadas
por `@import` do Google Fonts no mesmo CSS.

**Uso diferenciado por contexto**: a tela de login usa o bordô como fundo cheio (dramático,
"vitrine" da marca — `bg-wine-950`), enquanto as telas de trabalho (home, admin) usam fundo
claro (`bg-cream-50`) com bordô só em acentos (título, links, botões primários) — telas
densas de dados (tabelas, formulários) precisam de contraste alto e leitura prolongada
confortável, um fundo bordô cheio nelas seria pior para uso real. Cores semânticas de status
(`Badge.tsx`: verde/cinza/vermelho para ativo/inativo/bloqueado) foram mantidas como estão,
não substituídas por bordô/dourado — cor de status carrega significado (sucesso/neutro/
alerta) que não deve ser sacrificado por consistência de marca.

Criado também `components/AppLayout.tsx` — cabeçalho comum (marca + navegação + "Sair") para
toda tela autenticada, resolvendo de quebra uma lacuna real: `UsersPage`/`UserFormPage` não
tinham nenhum jeito de deslogar sem voltar manualmente para `/`.

### Consequências

- `LoginPage.tsx`, `App.tsx`/`HomePage`, `UsersPage.tsx`, `UserFormPage.tsx`, `UserForm.tsx`
  migrados da paleta azul genérica/HTML sem estilo para `wine`/`gold`/`cream`. Nenhum uso de
  `blue-*` restante no frontend.
- Qualquer tela nova (003 em diante) deve reutilizar os tokens `wine-*`/`gold-*`/`cream-*` e
  `font-display`/`font-sans` já definidos em `index.css`, envolvida em `AppLayout`, em vez de
  reintroduzir cores ad-hoc.
- **Fora do escopo desta decisão**: o site institucional real não tem nenhuma página além do
  "Em breve" — não há mockups de e-commerce, catálogo público etc. para se inspirar; quando
  essas telas existirem (fase 3, fora do MVP), a paleta aqui definida é o ponto de partida,
  não uma garantia de que baterá com o design final do site quando ele for ao ar.

---

## ADR-006 — `ignoreUndefined: true` no MongoClient (bug de semântica de campo opcional)

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [008-auditoria](../specs/008-auditoria/spec.md) (onde foi descoberto),
mas a correção vale para **todo** o backend, já que é uma opção do client compartilhado.

### Contexto

Implementando o teste de integração de 008 (T002), um caso previsto na própria spec —
`LOGIN_FAILED` para e-mail inexistente não deve ter `userId` — falhava de um jeito
inesperado: o campo não vinha ausente, vinha `null`. Investigação: o driver oficial do
MongoDB (Node) converte, por padrão, campos com valor `undefined` em BSON `null` na
inserção, em vez de simplesmente omitir a chave do documento. Todo o código do projeto
(schemas Zod com `.optional()`, `record()` recebendo `userId?: string`) foi escrito supondo
que "opcional" significa "ausente quando não aplicável", não "`null` quando não aplicável".

### Decisão

Adicionar `{ ignoreUndefined: true }` na construção do `MongoClient` em
`backend/src/database/mongo.client.ts` — com isso, campos `undefined` passados a
`insertOne`/`updateOne` etc. são omitidos de verdade, restaurando a semântica original em
todo o app (não só em `audit_logs` — qualquer repository futuro que insira um campo opcional
como `undefined` se beneficia da mesma correção).

**Documentos gravados antes desta correção continuam com `null` explícito no banco** (dev e
possivelmente test/prod, dependendo de quando cada um recebeu o fix) — não houve migração
retroativa dos dados existentes, é uma mudança pontual barata demais para justificar isso.
Por causa disso, os schemas de leitura que podem encontrar dados antigos
(`AuditLogOutputSchema` no backend, `AuditLogEntrySchema` no frontend) aceitam `null` além de
ausente (`.nullable().optional()`) nos campos afetados (`userId`, `entityId`, `metadata`) —
já os schemas de **escrita** (`AuditLogSchema`, usado por `record()`) continuam só
`.optional()`, já que código novo nunca deve gravar `null` de propósito.

### Consequências

- Qualquer repository futuro (categorias, produtos, imagens) que insira um documento com
  campo opcional ausente (`ObjectId | undefined`, por exemplo) já se beneficia da correção
  sem precisar de nenhuma mudança adicional — não é preciso lembrar de tratar isso caso a
  caso.
- Schemas de **leitura** de dados que já existiam antes desta data (14/09/2026) devem
  continuar aceitando `null` nos campos que eram opcionais — não assumir que só porque o
  client foi corrigido, todo dado no banco já reflete isso.
- `user.repository.ts` não foi afetado na prática porque seus campos opcionais já eram
  modelados como `T | null` explícito (`createdBy`, `lastLoginAt`), nunca `T | undefined` —
  só `audit_logs` usava a semântica `undefined` de fato.

---

## ADR-007 — `department` pertence à categoria, não ao produto (resolve conflito spec vs. glossário)

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [003-categorias](../specs/003-categorias/spec.md)

### Contexto

`specs/003-categorias/spec.md` (seção 2, modelo de dados; seção 5, critérios de aceite)
define `department` como campo obrigatório de `categories`. `memory/glossary.md` (versão
anterior) descrevia "Departamento" como campo do **produto**
(`classificacao.departamento`), "distinto de categoria" — direta contradição. O catálogo de
referência da spec (seção 2 — 11 códigos) não atribui departamento a nenhum deles.

### Decisão

Seguir `specs/003-categorias/spec.md` ao pé da letra: `department` é campo obrigatório de
`categories`, validado na criação (`CreateCategorySchema`). `memory/glossary.md` corrigido
para refletir isso — quando 005-produtos-cadastro-manual for implementada, o departamento
exibido/filtrado no produto deriva da categoria selecionada, não é digitado
independentemente.

Distribuição de `department` para o catálogo de referência (script `seed-categories.ts`,
sem base na spec, que não atribui nenhum) — decisão de dado inicial, editável depois pela
tela de admin:

| Departamento | Categorias |
|---|---|
| Masculino | BERM, CALC, CAMI, POLO, JAQU |
| Feminino | VEST, BLUS, SAIA |
| Unissexo | SAPT, BOLS, ACES |

### Consequências

- Uma categoria tem exatamente um departamento fixo — uma peça "unissex" dentro de uma
  categoria departamentalizada (ex.: uma calça jeans unissex em `CALC`, marcada
  "Masculino") usa o departamento da categoria mesmo assim; não há mecanismo de override por
  produto nesta fase. Se isso se mostrar problemático quando 005 for implementada, é uma
  revisão de escopo da spec 003, não um bug de 003 em si.
- `memory/glossary.md` deixou de ser fonte confiável nesse ponto específico até esta
  correção — reforça a prática de verificar a spec real antes de confiar cegamente no
  glossário quando os dois divergem (o glossário é resumo, a spec é a fonte primária).

---

## ADR-008 — `z.coerce.boolean()` não serve para query strings (bug real, corrigido)

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [003-categorias](../specs/003-categorias/spec.md)

### Contexto

Testando `GET /api/categories?active=false` manualmente no navegador (fluxo real, não só
`app.inject()`), o filtro não funcionava — retornava categorias ativas mesmo pedindo
`active=false`. Causa: `ListCategoriesQuerySchema` usava `z.coerce.boolean()`, que por baixo
dos panos chama o construtor `Boolean(valor)` do JavaScript — e `Boolean("false")` é `true`,
porque qualquer string não vazia é *truthy*. Como toda query string chega como texto,
`?active=false` sempre virava `true`. O teste de integração original só cobria
`?active=true` (que por coincidência também dá `true` com o bug), então passou sem detectar
o problema — só apareceu testando manualmente no navegador.

### Decisão

Trocado por um enum explícito com transform:
```ts
active: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true"))
```
Adicionado um teste de integração específico para `active=false` (não só `active=true`), que
teria pego esse bug automaticamente.

### Consequências

- Nenhum outro uso de `z.coerce.boolean()` no backend (conferido via busca no código) — bug
  isolado a este único campo.
- **Regra geral para qualquer schema futuro de query string**: nunca usar
  `z.coerce.boolean()` para um parâmetro que pode chegar como `"false"` — sempre usar
  `z.enum(["true","false"]).transform(...)` ou equivalente. `z.coerce.number()` e
  `z.coerce.date()` não têm esse problema (não dependem de truthiness de string) e continuam
  seguros de usar.
- Reforça a prática já estabelecida na sessão: sempre que possível, testar o fluxo real no
  navegador/via curl além dos testes automatizados — os testes de integração cobrem o que
  quem os escreveu pensou em cobrir, não substituem validação manual contra o comportamento
  real.

---

## ADR-009 — Topologia do MongoDB Atlas: 3 ambientes (dev/test/prod), M0 por enquanto

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** nenhuma spec específica — infraestrutura transversal.

### Contexto

O projeto precisava de um MongoDB Atlas real (constituição, seção 2) hospedado com Azure
como provedor de nuvem, já que o usuário tinha uma subscription Azure com créditos
disponíveis e queria aproveitá-los. Duas perguntas em aberto: quantos ambientes provisionar
agora, e qual tier de cluster usar.

### Decisão

- **3 Organizations/Projects separados no Atlas** — `openerpsample-dev`, `-test`, `-prod` — em
  vez de um projeto único com múltiplos bancos. Isolamento de rede, usuários de banco e
  billing por ambiente.
- **Tier M0 (gratuito) nos três**, por enquanto — não M10 dedicado via Azure Marketplace.
- Credenciais de cada ambiente ficam em `mongodbEnvironments/*.env` (gitignored, nunca
  versionado) — cada arquivo com `MONGODB_URI` própria.
- `backend/.env` (dev) e `e2e/.env` (test) apontam cada um para o cluster do seu ambiente.

### Consequências

- **Os créditos Azure não são consumidos por este provisionamento** — M0 é cobrado (na
  prática, gratuito) diretamente pela MongoDB, não passa pela Azure Marketplace. Só clusters
  M10+ dedicados são faturados através da subscription Azure. Isso foi uma escolha
  consciente: adiar o custo de M10 até existir necessidade real de produção (constituição,
  princípio V), mesmo sabendo que isso significa não usar os créditos ainda.
- Quando o projeto for para produção de verdade, migrar o Project `openerpsample-prod` de M0
  para M10 (Azure Marketplace) é o gatilho que efetivamente consome os créditos — documentado
  como próximo passo, não implementado agora.
- `mongodb+srv://` (formato padrão do Atlas) depende de resolução de registro DNS **SRV**, que
  algumas redes domésticas/de provedor (comum no Brasil) não suportam — causa
  `querySrv ECONNREFUSED`. Correção não é trocar a URI para o formato "expandido" (sem SRV)
  permanentemente — isso muda se o Atlas reconfigurar os nós do cluster — e sim trocar o DNS
  da máquina para um resolvedor público (8.8.8.8/1.1.1.1); a forma expandida é só um
  workaround documentado em `backend/.env.example` para quem não puder trocar o DNS.

---

## ADR-010 — Infraestrutura de E2E: Playwright Test em `e2e/` na raiz, contra o cluster de teste

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [001-autenticacao](../specs/001-autenticacao/spec.md),
[002-usuarios](../specs/002-usuarios/spec.md) (primeiras specs com tarefas de E2E concluídas)

### Contexto

001 e 002 têm tarefas de E2E no `tasks.md` (ex.: "login completo até o dashboard", "acesso
negado para operador"), mas o projeto não tinha nenhuma infraestrutura de E2E — só os testes
de integração do backend (`mongodb-memory-server` + `app.inject()`, que nunca abrem um
browser real nem servem o frontend).

### Decisão

- **Playwright Test** (não só a lib `playwright` usada manualmente) como test runner de E2E.
- Vive em **`e2e/` na raiz do projeto** — não dentro de `backend/` nem `frontend/`, porque
  cobre os dois juntos. Pacote npm próprio (`@openerp-sample/e2e`), com seu próprio
  `package.json`, `.env` e `tsconfig.json`.
- `playwright.config.ts` usa `webServer` (array) para subir backend e frontend juntos antes
  dos testes, com `reuseExistingServer: !process.env.CI` (aproveita servidores já rodando em
  dev local; sempre sobe do zero em CI).
- `global-setup.ts` garante o admin de fixture (idempotente) **reaproveitando os módulos reais
  do backend** (`connectMongo`, `userRepository`, `hashPassword`) em vez de duplicar lógica de
  seed — mesmo espírito do `seed-admin.ts` (ADR-004).
- **Banco: o cluster de teste dedicado do Atlas** (`openerpsample-test`, ver ADR-009) — não
  `mongodb-memory-server` (que os testes de integração do backend já usam) nem o cluster de
  dev. E2E existe justamente para validar contra infraestrutura próxima da real; usar
  memory-server aqui reduziria essa garantia.
- Cada spec de teste é autossuficiente (specs rodam em paralelo por padrão) — nunca depende de
  outro arquivo de teste ter rodado antes; recursos de teste (usuários) usam e-mail com
  timestamp para nunca colidir com o índice único.

### Consequências

- Rodar `npm test` em `e2e/` cria dados reais no cluster de teste a cada execução (usuários
  com e-mail único) — não há limpeza automática entre execuções; aceitável para um banco que
  existe só para isso.
- Se alguém tiver um backend de dev rodando manualmente na porta 3333 ao rodar os testes E2E
  localmente, `reuseExistingServer` vai reaproveitar esse processo — e os testes rodam contra
  o banco de **dev**, não o de teste. Documentado como cuidado em `e2e/AGENTS.md`, não
  resolvido automaticamente (aceito como trade-off de simplicidade).
- Specs futuras (003 em diante) que ganharem tarefas de E2E devem seguir o mesmo padrão —
  nenhuma infraestrutura nova de E2E deve ser criada por spec.

---

## ADR-011 — `shared/` é um pacote compilado independente, não um workspace npm

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [005-produtos-cadastro-manual](../specs/005-produtos-cadastro-manual/spec.md)
(primeiro consumidor real), qualquer spec futura que use `shared/schemas/*`.

### Contexto

Até 005, `shared/` existia só como pasta vazia (`.gitkeep`). O plan.md de 005 previa
`shared/schemas/product.schema.ts` como "fonte única de verdade", importada por
`backend/src/schemas/product.schema.ts` e futuramente pelo frontend. Testado empiricamente
antes de escrever o schema: importar `../../shared/schemas/product.schema.ts` (fonte bruta)
por caminho relativo direto do backend quebra `tsc` com `TS6059 (File is not under
'rootDir')` — tanto em `--noEmit` quanto no build real — porque `backend/tsconfig.json` tem
`rootDir: "src"`. Além disso, `shared/` não tinha `node_modules` próprio, então nem `zod`
resolvia em runtime (`tsx`) nem em type-check.

Duas soluções possíveis: (a) migrar `backend/`, `frontend/`, `e2e/` para um workspace npm
(root `package.json` com `"workspaces"`), o que resolveria a resolução de módulo de forma
mais elegante (import por nome de pacote, sem build step); (b) manter `shared/` como um
pacote isolado igual aos outros (próprio `package.json`/`node_modules`), compilado para
`shared/dist/`, consumido via caminho relativo ao **build**, não ao `.ts` fonte.

### Decisão

Opção (b). `shared/` ganhou `package.json` (`@openerp-sample/shared`), `tsconfig.json`
(`outDir: "dist"`, `declaration: true`), `eslint.config.js` e `AGENTS.md` próprios — mesmo
padrão de isolamento de `backend/`/`frontend/`/`e2e/` (cada um com instalação e
`package-lock.json` independentes). `npm run build` gera `shared/dist/schemas/*.js` +
`*.d.ts`; `backend`/`frontend` importam `../../../shared/dist/schemas/product.schema.js`,
nunca o `.ts` fonte. Validado empiricamente: `tsc --noEmit`, `tsc -p tsconfig.json` (build) e
execução via `tsx` funcionam limpos dos dois lados consumindo o `dist/` compilado.

### Consequências

- **Sem workspace npm neste projeto** — rejeitado por ser uma mudança de infraestrutura mais
  ampla (restruturaria a instalação de `backend/`, `frontend/`, `e2e/` já funcionando e
  testada) do que o necessário só para compartilhar um schema. Reavaliar se `shared/` crescer
  a ponto de o build manual virar fricção real no dia a dia (constituição, princípio V).
- **Trade-off aceito**: quem editar `shared/schemas/*.ts` precisa rodar `npm run build` lá
  antes de a mudança aparecer em `backend/`/`frontend/` — não há watch mode automático
  configurado. Documentado com destaque em `shared/AGENTS.md` justamente para não ser
  esquecido por um agente/dev futuro.
- Qualquer schema novo que precise ser compartilhado entre backend e frontend (ex.: quando
  006-produtos-cadastro-ia reaproveitar `ProductSchema`) segue o mesmo padrão — nenhuma
  reinvenção de mecanismo por spec.
- **Addendum (frontend, 005 Fase 5)**: o Vite dev server bloqueia por padrão servir arquivos
  fora da raiz do projeto (`frontend/`) — importar `shared/dist/...` (um nível acima) falhava
  em runtime no navegador com "The request url is outside of Vite serving allow list", mesmo
  com `tsc -b` limpo. Corrigido com `server.fs.allow: [<raiz do monorepo>]` em
  `frontend/vite.config.ts`. Qualquer app servido por Vite que importe de `shared/` precisa
  dessa mesma configuração.

---

## ADR-012 — Limite de fotos por peça vive no `ProductSchema`, não em `POST /api/images`

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [007-imagens](../specs/007-imagens/spec.md),
[005-produtos-cadastro-manual](../specs/005-produtos-cadastro-manual/spec.md)

### Contexto

007 previa validar "número máximo de imagens por peça" dentro de `image.service.ts`, no
momento do upload (`POST /api/images`). Na integração real com 005 (pedido do usuário: "cada
produto pode ter N fotos"), ficou claro que essa rota não é — e nunca foi — escopada por
produto: um upload pode acontecer **antes** do produto existir (durante o cadastro manual, o
operador sobe fotos enquanto ainda preenche o formulário). Validar a contagem na rota exigiria
ou (a) passar um `productId`/`draftId` opcional em todo upload, com um caminho especial para
"ainda não tem produto", ou (b) confiar inteiramente no cliente.

### Decisão

O limite (`MAX_PRODUCT_IMAGES = 10`, escolha arbitrária da implementação — a spec não fixa um
número) vive em `shared/schemas/product.schema.ts`, como `.max()` no array
`ImagensSchema.galeria`. `POST /api/images` faz upload de **um arquivo solto**, sem qualquer
noção de quantidade — a validação de quantidade acontece só quando o array completo de fotos é
enviado dentro de `POST`/`PATCH /api/products`, pelo mesmo Zod que já é a fonte única de
verdade do modelo. O frontend (`ImageUploader.tsx`) lê a mesma constante para desabilitar o
botão de adicionar fotos ao atingir o limite — nenhum número mágico duplicado.

### Consequências

- `POST /api/images` permanece uma rota genérica e reutilizável (006 vai usá-la do mesmo
  jeito, sem precisar inventar um fluxo de upload "pré-produto" separado).
- Trade-off aceito: um cliente que ignore o limite do frontend pode, em teoria, fazer upload
  de mais de `MAX_PRODUCT_IMAGES` blobs "soltos" (nunca embutidos em produto nenhum) — não é um
  problema de integridade de dados (o `ProductSchema` sempre barra o excesso no momento de
  salvar), só um desperdício de armazenamento no pior caso. Aceitável porque upload exige
  `authenticate` + `authorize(["admin","operator"])`, não é uma rota pública.
- Primeira foto da galeria = `imagens.principal` automaticamente, tanto na criação quanto na
  edição — sem seletor de "foto de capa" dedicado no MVP (não pedido explicitamente; reavaliar
  se o backoffice precisar de controle manual da ordem/capa no futuro).

---

## ADR-013 — Defesa em profundidade contra prompt injection em 006 (nenhuma defesa única é suficiente)

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [006-produtos-cadastro-ia](../specs/006-produtos-cadastro-ia/spec.md)

### Contexto

006 é a única spec do projeto que envia conteúdo fornecido por usuário (texto + imagens) a um
LLM. Isso introduz uma classe de risco nova (OWASP LLM01, *Prompt Injection*) que nenhuma
outra spec tem: uma instrução maliciosa pode chegar tanto pelo campo de descrição digitado
quanto — de forma mais perigosa, porque não aparece em nenhum campo revisável antes do envio —
embutida numa foto (uma etiqueta fotografada com texto adversarial, um cartaz, um QR code).

O risco só foi endereçado até então de forma implícita: a spec original já dizia "IA nunca
inventa categoria" e "human in the loop", mas não havia um modelo de ameaça explícito nem um
prompt de sistema com guardrails redigidos para resistir a injeção.

### Decisão

Nenhuma defesa isolada é tratada como suficiente — a spec (seção 8) define 9 defesas
independentes e cumulativas, a maioria estrutural (na aplicação, não no modelo):

1. Resposta bruta do modelo nunca é executada/interpretada — só entra como dado de
   `Zod.parse()`.
2. `AiSuggestedProductSchema` é **`.strict()`**: qualquer chave fora do schema rejeita a
   resposta inteira (falha visível), nunca é descartada em silêncio (`.strip()` implícito do
   Zod, que seria o padrão, foi explicitamente rejeitado aqui por esconder tentativas de
   injeção em vez de expor).
3. O schema estruturalmente **não contém** `sku`/`preco`/`status`/`estoque`/`ecommerce`/
   `venda` — não há campo para uma instrução maliciosa "vazar" para esses valores, mesmo que
   o modelo tente.
4. `categoria_codigo` é revalidado no backend (`assertCategoryActive`, 003) depois da resposta
   — o prompt informar a lista de categorias ativas é só uma redução de ruído, nunca a defesa
   real.
5. **Nenhuma capacidade de function/tool calling é concedida ao modelo** — decisão permanente,
   não uma limitação temporária (também alinhada ao princípio V, sem orquestração de agente
   nesta fase). Mesmo uma injeção bem-sucedida "dentro do modelo" não tem nenhuma ação a
   tomar além de tentar alterar o JSON de saída, que cai nas defesas 2–3.
6. Cada `/analyze` é stateless/turno único — sem contaminação entre requisições.
7. Human in the loop (princípio II) continua como última barreira — nada é persistido sem
   confirmação humana em `/confirm`.
8. Rate limiting (já especificado) limita a velocidade de tentativa e erro.
9. Um **prompt de sistema com guardrails explícitos** (spec, seção 8.3, 7 regras numeradas)
   instrui o modelo a tratar todo conteúdo analisado — texto da descrição e texto/símbolos
   dentro das imagens — como dado, nunca como instrução, e a nunca produzir nada fora do
   schema. É tratada como a defesa **mais fraca** da lista (a única que depende do modelo
   "obedecer"), nunca como a principal.

O mesmo texto do prompt de sistema (spec, seção 8.3) foi replicado como
`DEFAULT_SYSTEM_PROMPT` em `backend/src/plugins/ai/openai-compatible.adapter.ts` — esse
arquivo já existia (construído antecipadamente, ver ADR-002) com uma versão sem guardrails de
injeção; foi atualizado para não deixar um fallback inseguro em código enquanto a spec já
documenta a versão correta.

### Consequências

- `ai-intake.service.ts` (ainda não implementado) tem um contrato de teste mais rígido: mocks
  do adapter retornando campos fora do schema ou categoria inventada precisam ser
  explicitamente testados como rejeitados (tasks.md de 006, T003/T004).
- `.strict()` tem um custo real: qualquer verbosidade extra do modelo (comentário acidental,
  campo a mais por "criatividade" do provedor) vira falha de análise em vez de sucesso
  parcial. Aceito deliberadamente — falhar visivelmente e deixar o operador tentar de novo (ou
  cadastrar manualmente, 005) é preferível a aceitar uma resposta parcialmente fora de
  contrato.
- Qualquer spec futura que envie conteúdo de usuário a um LLM deve replicar esse mesmo
  raciocínio de defesa em profundidade — não é específico de 006, é o padrão do projeto para
  qualquer integração LLM+dado de usuário.
- **Addendum (2026-09-14, mesmo dia)**: revisão apontou que a regra 1 original ("trate texto
  de imagem como dado, nunca como comando") era ambígua o bastante para gerar **falso
  positivo** justamente no caso de uso mais importante de 006 — identificação de marca. Uma
  marca/slogan real que soa como frase imperativa (ex. "Obey", "Just Do It") ficaria em risco
  de ser tratada como tentativa de injeção e suprimida, zerando `marca.nome` sem necessidade.
  Corrigido dividindo a regra original em duas (prompt agora tem 8 regras, não 7): regra 1
  afirma explicitamente que ler etiqueta/marca é o objetivo central da tarefa, com exemplos
  positivos; regra 2 restringe o "não obedecer" só a texto que se dirige explicitamente ao
  sistema de IA (menciona prompt/instruções/JSON/schema/etc.), nunca a texto de produto comum.
  Registrado como critério de aceite específico (spec, seção 8.4, "leitura legítima de
  etiqueta") — não é testável automaticamente (é comportamento de modelo, não regra de
  código), então exige validação manual do prompt contra fotos reais antes de fechar T006.
  Lição geral: todo guardrail de anti-injeção precisa ser revisado contra o caso de uso
  legítimo mais próximo da linguagem que ele bloqueia, não só contra o ataque.

---

## ADR-014 — Dashboard reaproveita `AppLayout` em vez de criar um layout de sidebar paralelo

**Status:** Aceita
**Data:** 2026-09-14
**Specs afetadas:** [009-dashboard](../specs/009-dashboard/spec.md)

### Contexto

O `plan.md` original de 009 (escrito antes de qualquer frontend existir) previa
`layouts/BackofficeLayout.tsx` com `Sidebar.tsx`/`Header.tsx` dedicados, espelhando o layout
de referência da spec (menu lateral esquerdo). Isso foi escrito antes de
`components/AppLayout.tsx` existir — criado em 002-usuarios como o cabeçalho horizontal usado
por **toda** tela autenticada do app desde então (produtos, categorias, usuários, auditoria),
já com navegação filtrada por `role` e botão de logout.

Ao chegar em 009, implementar o `plan.md` ao pé da letra criaria dois sistemas de layout
paralelos e incompatíveis no mesmo app — um usado por todas as telas existentes (`AppLayout`,
topo) e um novo só para o dashboard (`BackofficeLayout`, lateral) — sem nenhuma necessidade
real, já que `AppLayout` já resolve navegação + permissões + identidade visual.

### Decisão

`DashboardPage` é renderizada dentro do `AppLayout` existente, como qualquer outra página do
app. `AppLayout` ganhou um link "Dashboard" (primeiro item do menu, antes de "Produtos"),
apontando para `/`. Nenhum componente novo de layout/sidebar/header foi criado;
`components/Loading.tsx` também não — o padrão inline já usado em toda página
(`{isLoading && <p>Carregando...</p>}`) foi mantido por consistência.

### Consequências

- O layout de referência da spec 009 (seção 3, menu lateral) fica só ilustrativo — o mesmo já
  acontecia com mockups ASCII de outras specs (ex. 005) que não foram seguidos pixel a pixel.
  Não é necessário atualizar a spec por isso.
- Qualquer spec futura que cogite um novo "layout" deve primeiro verificar se `AppLayout` já
  resolve — criar um layout paralelo só se houver um motivo concreto (ex. uma área
  publicamente acessível sem cabeçalho autenticado), nunca por seguir um `plan.md` escrito
  antes do layout real existir.
- `plan.md`/`tasks.md` de 009 foram atualizados para refletir a estrutura de arquivos real
  (sem `Sidebar.tsx`/`Header.tsx`/`Loading.tsx`/`BackofficeLayout.tsx`).

---

## ADR-015 — Deploy em container único (removida)

Removida nesta versão de demonstração: CI/CD, deploy e infraestrutura de produção estão
fora do escopo deste repositório.

---

## ADR-016 — Correção de bug decimal no formulário de preço + ativação de multi-moeda

**Status:** Aceita
**Data:** 2026-09-15
**Specs afetadas:** [005-produtos-cadastro-manual](../specs/005-produtos-cadastro-manual/spec.md)

### Contexto

Bug relatado em produção: os campos de preço no cadastro de produto (`ProductForm.tsx`) não
aceitavam valores decimais digitados com vírgula (convenção brasileira, ex. "19,90"). Causa:
os inputs eram `<input type="number">`, e a maioria dos navegadores (Chrome/Edge/Firefox
modernos) simplesmente **ignora o caractere vírgula** nesse tipo de input — o usuário digitando
"19,90" acabava salvando "1990" (100× o valor pretendido), um bug de corrupção silenciosa de
dado, não só de UX.

Ao investigar, o schema (`shared/schemas/product.schema.ts`) já tinha um campo `moeda` em
`PrecoSchema`, mas o `MoedaEnum` só aceitava `"BRL"` e nenhuma tela expunha um seletor — a
extensibilidade estava desenhada mas nunca finalizada. O usuário pediu, no mesmo momento, pra
já suportar R$, US$ e €.

### Decisão

1. Trocar os 4 inputs de preço (`preco_original_estimado`, `custo_aquisicao`, `preco_venda`,
   `preco_promocional`) de `type="number"` para `type="text" inputMode="decimal"`, com parsing
   próprio (`parseOptionalNumber` em `frontend/src/schemas/product.schema.ts`) que aceita tanto
   vírgula quanto ponto como separador decimal — normaliza pra ponto antes de `Number()`.
2. Validação client-side (`superRefine`) rejeita texto que não bate com `/^\d+([.,]\d{1,2})?$/`,
   evitando que um valor inválido seja silenciosamente descartado (comportamento anterior do
   `parseOptionalNumber`, que devolvia `undefined` para qualquer `NaN`).
3. `MoedaEnum` (shared) expandido de `["BRL"]` para `["BRL", "USD", "EUR"]`. Um seletor de moeda
   foi adicionado ao fieldset "Preço" do formulário — um único campo por produto (não por linha
   de preço, já era assim no schema). Exibição (`ProductCard.tsx`) usa `Intl`/`toLocaleString`
   com locale por moeda (`pt-BR`/`en-US`/`de-DE`) pra formatação correta do símbolo.

### Consequências

- Sem migração de dados: produtos existentes já têm `moeda: "BRL"` (default do schema desde a
  criação do campo); nada muda pra eles.
- **Fora do escopo desta decisão:** conversão/agregação entre moedas diferentes. Dashboard e
  filtros de preço (`preco_min`/`preco_max`) continuam tratando o valor numérico como está
  gravado, sem normalizar por câmbio — misturar produtos em moedas diferentes num mesmo filtro
  de faixa de preço não é semanticamente correto hoje; resolver isso é decisão futura, só se
  vender em múltiplas moedas de fato virar necessidade real.
- Os filtros de faixa de preço (`ProductFilters.tsx`) e os campos de medidas (cintura, quadril
  etc., que reaproveitam o mesmo `parseOptionalNumber`) não foram alterados quanto ao tipo do
  input — o bug relatado era especificamente nos 4 campos de preço do cadastro; mesma classe de
  problema pode existir ali, mas não foi escopo deste fix.

---

## ADR-017 — Rollback de deploy (removida)

Removida nesta versão de demonstração: CI/CD, deploy e infraestrutura de produção estão
fora do escopo deste repositório.

---

## ADR-018 — Domínio customizado de produção (removida)

Removida nesta versão de demonstração: CI/CD, deploy e infraestrutura de produção estão
fora do escopo deste repositório.

---

## ADR-019 — Cabeçalho responsivo (menu hambúrguer) e coluna de ações fixa na tabela

**Status:** Aceita
**Data:** 2026-09-15
**Specs afetadas:** nenhuma spec de domínio específica — corrige o requisito não funcional já
existente ("aplicação responsiva", [constitution.md, seção 5](../memory/constitution.md)).

### Contexto

Usuário pediu uma revisão de design pra celular em retrato (9:18). Investigação com
screenshots reais (Playwright, viewport 390×780) revelou um bug real e sério, não cosmético:
`AppLayout.tsx` tinha uma `<nav>` horizontal fixa com ~6 itens (Dashboard/Produtos/
Categorias/Usuários/Auditoria/nome/Sair) numa única linha, sem quebra nem colapso — em telas
estreitas isso empurra a página inteira pra ter scroll horizontal, e o botão **"Sair" (logout)
fica completamente fora da área visível**, só alcançável rolando a página pra direita (sem
nenhuma pista visual de que isso é necessário). O resto do app (formulários, grids, filtros)
já respondia bem graças a `grid-cols-1`/`flex-wrap`/`overflow-x-auto` já existentes — não foi
necessário mexer neles.

Um segundo problema, descoberto só depois de corrigir o primeiro (o primeiro mascarava o
segundo, já que a página inteira estava fora de escala): a tabela genérica (`Table.tsx`,
reusada em produtos/categorias/usuários/auditoria) rola horizontalmente em telas estreitas
(`overflow-x-auto` já existia), mas a coluna de ações (sempre a última, por convenção) ficava
escondida fora da área visível sem nenhuma indicação de que dava pra arrastar pra vê-la — na
prática, "Editar" ficava inacessível pra quem não soubesse descobrir o scroll sozinho.

### Decisão

1. `AppLayout.tsx`: nav horizontal completa (`hidden md:flex`) só a partir de telas médias;
   abaixo disso, um botão hambúrguer (`md:hidden`) abre um painel com os mesmos links
   empilhados verticalmente, incluindo nome do usuário e "Sair". Cabeçalho nunca mais excede a
   largura da viewport.
2. `Table.tsx`: última coluna (convenção: sempre a de ações) ganha `position: sticky; right: 0`
   tanto no `<th>` quanto no `<td>` — fica sempre visível, mesmo sem o usuário rolar a tabela,
   com uma sombra sutil à esquerda sinalizando que há mais conteúdo por baixo. `group`/
   `group-hover` no `<tr>` mantém o fundo da coluna fixa consistente com o hover da linha.

### Consequências

- Validado com screenshots reais em viewport 390×780 (9:18), antes/depois de cada correção,
  login → dashboard → listagem de produtos → cadastro → cadastro por IA → categorias.
  Screenshots foram descartados depois (ferramenta de diagnóstico desta sessão, não fica no
  repo).
- Efeito colateral encontrado e corrigido: `e2e/tests/product-edit.spec.ts` mirava o campo de
  preço por `input[type="number"]`, que não existe mais desde
  [ADR-016](#adr-016--correção-de-bug-decimal-no-formulário-de-preço--ativação-de-multi-moeda)
  (campos de preço viraram `type="text"`) — o teste nunca tinha rodado desde aquela mudança.
  Corrigido pra mirar por rótulo (`getByLabel`), mais robusto a mudanças de tipo de input.
- Padrão de "última coluna fixa" em `Table.tsx` é genérico — qualquer tela nova que reaproveite
  o componente já herda o comportamento, sem precisar reimplementar.


---

## ADR-020 — Rotação da chave de criptografia das credenciais de marketplace: keyring versionado + script de re-cifragem

**Status:** Superada por [ADR-021](#adr-021--chave-de-criptografia-das-credenciais-envelope-encryption-com-rotação-manual-pelo-admin) (nunca chegou a ser usada)
**Data:** 2026-09-21
**Specs afetadas:** [011-integracao-marketplaces](../specs/011-integracao-marketplaces/spec.md)
(seção 3.1), [008-auditoria](../specs/008-auditoria/spec.md) (nova ação
`MARKETPLACE_CREDENTIAL_KEY_ROTATE`)

### Contexto

Credenciais de conta de marketplace (client secret, access/refresh token) são cifradas de forma
**reversível** (AES-256-GCM) porque o ERP precisa enviá-las ao Mercado Livre — hash, como nas
senhas (Argon2id), não serve. A chave ficava numa única variável de ambiente
(`MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY`) e o ciphertext não indicava com qual chave foi feito:
trocar a chave tornava **todas** as contas ilegíveis de uma vez (só re-autorizando cada uma no
marketplace), então na prática a chave nunca poderia ser trocada — nem após um vazamento suspeito.

### Decisão

1. **Keyring versionado** em `MARKETPLACE_CREDENTIAL_ENCRYPTION_KEYS` (`id:chaveBase64,...`): a
   primeira chave é a **ativa** (única que cifra); todas decifram.
2. **Ciphertext autodescritivo**: `{keyId}:{iv}:{authTag}:{dados}`. Ids de chave nunca são
   reutilizados (trocar o material sob o mesmo id equivale a perder as contas).
3. **Re-cifragem por script operacional** (`npm run rotate:credential-key`, mesmo padrão de
   `seed:admin`, ADR-004), não por rota HTTP nem job periódico: rotação é rara, manual e feita
   por quem tem acesso à infraestrutura — exatamente quem já controla a variável de ambiente.
   Idempotente, com `--dry-run`, falha isolada por conta, e gravação **condicional** ao valor
   lido (uma edição concorrente de admin nunca é sobrescrita).
4. **Auditoria** de cada rotação (só contagens e id da chave ativa, nunca credenciais).
5. **Sem suporte ao formato antigo** (3 partes, sem id): nenhuma conta real existia cifrada nele
   (a feature ainda não foi implantada); manter um caminho legado seria código morto.

Alternativas descartadas: **Azure Key Vault** (rotação e trilha de acesso melhores, mas nova
dependência, custo e credencial de acesso a gerenciar — princípio V; reavaliar se surgir exigência
de auditoria externa); **envelope encryption** com chave por conta (limita o estrago de um
vazamento, porém exige guardar/rotacionar as chaves de dados e ainda depende de uma chave-mestra
— a mesma questão em outro nível); **rotação por rota admin** (amplia a superfície de ataque: um
admin comprometido poderia disparar re-cifragem em massa).

### Consequências

- Rotação sem perda de dados: nova chave à frente → deploy → script → conferir zero contas na
  chave antiga → remover a antiga (procedimento na spec 011, seção 3.1).
- **Risco operacional residual**: remover uma chave do keyring antes de a rotação terminar torna as
  contas sob ela irrecuperáveis. Mitigação: o script imprime quantas contas estavam sob cada chave
  e sai com código 1 se alguma falhar; a regra de ouro está documentada em `.env.example` e na
  spec.
- Continua valendo: a chave só protege contra vazamento **do banco isolado**; quem comprometer o
  processo da aplicação tem chave e dados. Guardar cópia da chave fora do Azure e usar chaves
  distintas por ambiente continua sendo responsabilidade operacional.
- **Antes do primeiro deploy** da 011, a produção precisa de um keyring próprio
  (`v1:<chave nova>`, como *secret* do Container App) — a variável só existe no `.env` local.


---

## ADR-021 — Chave de criptografia das credenciais: envelope encryption com rotação manual pelo admin

**Status:** Aceita
**Data:** 2026-09-21
**Specs afetadas:** [011-integracao-marketplaces](../specs/011-integracao-marketplaces/spec.md)
(seção 3.1), [008-auditoria](../specs/008-auditoria/spec.md) (ação
`MARKETPLACE_CREDENTIAL_KEY_ROTATE`)

### Contexto

O [ADR-020](#adr-020--rotação-da-chave-de-criptografia-das-credenciais-de-marketplace-keyring-versionado--script-de-re-cifragem)
resolveu a rotação com um *keyring* em variável de ambiente e um script operacional. O pedido
seguinte foi **simplificar**: o administrador deve gerar e trocar a chave por um botão na tela de
contas de marketplace. Isso é incompatível com uma chave em variável de ambiente — a aplicação não
pode reescrever a configuração do Container App. E guardar a chave no banco em texto puro anularia a
proteção (o vazamento do banco expõe dados e chave juntos).

### Decisão

**Envelope encryption**, duas camadas:

1. **Chave-mestra** (`MARKETPLACE_CREDENTIAL_MASTER_KEY`, variável de ambiente, definida uma vez por
   ambiente) — única chave fora do banco; só embrulha chaves de dados.
2. **Chaves de dados** versionadas (`k1`, `k2`, ...) na collection `credential_keys`, **sempre
   cifradas pela chave-mestra** (AES-256-GCM, id da chave como AAD). Cifram as credenciais; o
   ciphertext carrega o id da chave (`k2:iv:tag:dados`). A ativa é a de **maior versão**, o que
   torna a ativação atômica e dispensa flag de status, índice parcial e transação.
3. **Botão "Rotacionar chave de criptografia"** (admin, manual, com confirmação): cria a próxima
   versão, re-cifra todas as contas e audita. Chaves antigas são **retidas** (só decifram), então
   nenhuma credencial se perde se alguma conta falhar. Duas rotações simultâneas: a segunda leva
   `409` (`_id` duplicado). Gravação de cada conta é condicional ao valor lido.
4. A primeira chave de dados é **criada sozinha**; ninguém gera nem cola chave.
5. Chave lida do banco **a cada operação, sem cache** — correto com várias réplicas, ao custo de uma
   leitura pequena por cifra/decifra (raras e dominadas pela chamada de rede ao marketplace).
6. O script e o keyring do ADR-020 foram removidos; sem suporte a formato anterior (nenhuma conta
   real existia cifrada).

Alternativas descartadas: manter o script e só adicionar o botão (o botão não teria como trocar a
variável de ambiente); **Azure Key Vault** com API de rotação (dependência, custo e permissão de
escrita na infraestrutura a partir da aplicação — princípio V); chave de dados em texto puro no banco
(anula a proteção).

### Consequências

- Admin rotaciona sozinho, sem acesso à infraestrutura. O que o admin vê são só metadados (id,
  versão, data, contagem por chave) — nunca material de chave.
- A **chave-mestra vira o segredo crítico**: perdê-la ou trocá-la torna todas as chaves de dados
  ilegíveis (contas precisam ser recadastradas). Guardar cópia fora do Azure; valores diferentes por
  ambiente; em produção, como *secret* do Container App. Sua própria rotação (re-embrulhar as
  chaves de dados, poucas) é rara e **fora de escopo** por ora.
- Como a chave-mestra e o banco estão no mesmo ambiente de execução, quem comprometer o processo da
  aplicação tem acesso a ambos — a proteção continua sendo contra vazamento **do banco isolado**
  (backups, dumps, cópia de cluster).
- Rotacionar não apaga chaves antigas: a rotação limita o uso futuro de uma chave, não remove
  ciphertexts já copiados em backups antigos cifrados com ela.
- **Antes do primeiro deploy** da 011: gerar `MARKETPLACE_CREDENTIAL_MASTER_KEY` de produção e
  configurá-la como *secret* do Container App (hoje só existe no `.env` local).


## ADR-022 — Exclusão física de conta de marketplace, condicionada a Desconectar → Desativar → Apagar

**Status:** Aceita
**Data:** 2026-09-21
**Specs afetadas:** [011-integracao-marketplaces](../specs/011-integracao-marketplaces/spec.md)
(seção 2.2.2), [008-auditoria](../specs/008-auditoria/spec.md) (ações
`MARKETPLACE_ACCOUNT_DISCONNECT` e `MARKETPLACE_ACCOUNT_DELETE`)

### Contexto

A spec 011 previa só exclusão lógica para contas de marketplace (`active = false`). Na prática o
admin acumula contas de teste e tentativas de cadastro que não voltarão a ser usadas, e cada uma
mantém no banco Client ID/Secret (e tokens) cifrados. Pedido: além de desativar, poder **apagar**,
com fluxo obrigatório Desconectar → Desativar → Apagar.

### Decisão

1. `DELETE /api/marketplace-accounts/:id` remove fisicamente o documento — a **única remoção física**
   do sistema. O princípio VIII da constituição veda remoção física "por padrão" de usuários e
   produtos; esta é uma exceção deliberada para um registro cujo conteúdo é segredo.
2. A ordem é **imposta pelo backend** (`409` com o passo faltante), não só pela tela: desativar exige
   conta desconectada; apagar exige desconectada **e** desativada.
3. **Desconectar** (`POST /:id/disconnect`) descarta os tokens OAuth guardados (mantém Client
   ID/Secret, então dá para reconectar) e cancela qualquer autorização em andamento. É local ao ERP;
   não revoga a autorização no Mercado Livre.
4. Auditoria de desconexão e de exclusão (`MARKETPLACE_ACCOUNT_DISCONNECT`,
   `MARKETPLACE_ACCOUNT_DELETE`), com marketplace e apelido — nunca a credencial. O registro de
   auditoria é o que sobrevive à conta.
5. **Não se bloqueia** apagar conta com anúncios publicados: `products.marketplaces[]` já guarda
   `conta_id` + `conta_apelido` (snapshot), então produtos e selos continuam corretos; só se perde a
   capacidade de republicar por aquela conta.

Alternativas descartadas: manter só exclusão lógica (segredos ficariam para sempre no banco);
permitir apagar direto de qualquer estado (um clique errado descartaria uma conta conectada em uso);
bloquear a exclusão enquanto houver anúncios (o admin ficaria preso a contas mortas — os anúncios
já não dependem da conta no ERP).

### Consequências

- Apagar é irreversível; a tela pede confirmação. Recuperar exige recadastrar a conta.
- `accountsByKeyId` (rotação de chave) deixa de contar contas apagadas — e a rotação nunca mais
  precisa re-cifrar um segredo que o admin já descartou.
- Uma tentativa de republicar/retentar por conta apagada responde "Conta de marketplace não
  encontrada" (404), como já ocorria para conta inexistente.

### Adendo (2026-09-21) — anúncios no ar ao desconectar/apagar

A decisão 5 ("não se bloqueia apagar conta com anúncios publicados") **continua valendo**, mas a
revisão da spec passou a tratar o custo dela: encerrar um anúncio exige a conta ativa e conectada
([011](../specs/011-integracao-marketplaces/spec.md), seção 4.7), então desconectar ou apagar uma
conta com anúncios `publicado` deixa esses anúncios sem como ser encerrados pelo ERP. Em vez de
bloquear (o que travaria contas sem tokens), as confirmações de **Desconectar** e **Apagar**
mostram quantos anúncios `publicado` usam a conta e lembram de encerrá-los antes (seção 2.2.2). A
ordem recomendada passa a ser: Encerrar anúncios → Desconectar → Desativar → Apagar.

## ADR-023 — Conector Mercado Livre: trava por conta, modelo *User Products*, SKU em `SELLER_SKU` e pacote padrão configurável

**Status:** Aceita
**Data:** 2026-09-21
**Specs afetadas:** [012-conector-mercado-livre](../specs/012-conector-mercado-livre/spec.md),
[011-integracao-marketplaces](../specs/011-integracao-marketplaces/spec.md) (porta, seção 4.1; status
`encerrado`, seção 4.2; encerrar, seção 4.7)

### Contexto

A spec 012 entrega o primeiro adaptador real de marketplace. Ler a documentação do Mercado Livre
(páginas salvas em `DocumentacaoMercadoLivre/`, setembro/2026) mostrou restrições que moldam o
desenho: o `refresh_token` é de **uso único**; o modelo de publicação é o *User Products* (`family_name`
no lugar de `title`); o SKU vai no atributo `SELLER_SKU`; o Mercado Envios 2 exige dimensões de pacote
que o ERP não guarda; domínios de moda exigem tabela de medidas; e **não existe sandbox** (testes só
com usuários de teste).

### Decisão

1. **Trava por conta (*lease*) no documento da conta**, cobrindo a **operação inteira** (publicar,
   atualizar, encerrar), não só a renovação do token: campos internos `operationLeaseOwner` e
   `operationLeaseExpiresAt`, validade de 120 s, espera de até 15 s e depois `409`. Quem chega depois
   relê a credencial já renovada. Sem Redis nem fila (princípio V).
2. **A porta muda:** `publish` cria *ou atualiza* (decidido pelo `id_anuncio` da entrada), ganha `close`, e
   ambas devolvem `updatedCredential` no resultado **e** no erro. O adaptador **nunca** toca no MongoDB
   nem guarda estado por conta; quem grava o par novo é o serviço, de forma **condicional ao valor lido**
   (uma conta desconectada durante a operação descarta o par novo). A rotação de chave pula a conta
   ocupada.
3. **Modelo *User Products*:** o payload de criação usa `family_name` (sem `title`, sem `variations`)
   quando o vendedor tem a tag `user_product_seller`; sem a tag, o modelo antigo.
4. **SKU em `attributes[SELLER_SKU]`** (não em `seller_custom_field`); a busca da "resposta perdida" é
   `GET /users/{user_id}/items/search?seller_sku=`.
5. **Pacote padrão configurável** em `MERCADO_LIVRE_PACKAGE_DEFAULTS` (JSON validado por Zod), resolvido
   por categoria > departamento > padrão, com o peso do produto quando existir. Dimensões por produto no
   cadastro ficam como evolução (spec 005).
6. **Moda:** a v1 usa só tabelas de medidas `BRAND` e `STANDARD` já existentes; criar tabelas `SPECIFIC`
   fica fora de escopo. Sem tabela ou linha correspondente, a publicação falha antes do `POST`.
7. **Encerrar** é ação explícita do operador (princípio II), idempotente, e é a única forma de remoção;
   excluir o anúncio e reativar ficam fora de escopo.
8. **Testes reais só com usuário de teste**, como manda a documentação; a primeira publicação real é uso,
   não teste.

Alternativas descartadas: trava só no refresh (deixaria duas operações concorrentes na mesma conta);
Redis ou fila (princípio V); manter `title` + `variations` (o Mercado Livre deixa de aceitá-los após a
ativação do vendedor); `seller_custom_field` (a documentação de publicação manda `SELLER_SKU`);
dimensões por produto já na v1 (muda o cadastro, o formulário e a IA de cadastro antes de sabermos se o
pacote padrão basta); tela de administração do pacote padrão já na v1.

### Consequências

- O `refresh_token` de uso único deixa de ser um risco de corrida, ao custo de operações na mesma conta
  serem serializadas (aceitável para o volume do brechó).
- Uma trava órfã (processo que cai no meio) segura a conta por até 120 s.
- O pacote padrão é uma aproximação: peças volumosas precisam de entrada própria em `por_categoria`; a
  configuração é uma variável de ambiente, editada por quem administra o ambiente.
- Peças de moda cujo tamanho não case com as linhas das tabelas `BRAND`/`STANDARD` **não publicam** até
  haver normalização de tamanhos ou tabelas `SPECIFIC` (tarefa T050 mede isso com dados reais).
- O Mercado Livre fecha sozinho peças usadas de moda ao vender; o ERP só sabe se o operador encerrar ou
  marcar como vendida (sincronização de status segue fora de escopo).


## ADR-024 — Tabela de medidas de roupas do Mercado Livre: o ERP cria tabelas `SPECIFIC` via API, alimentadas pelas medidas reais de cada peça

**Status:** Aceita
**Data:** 2026-09-22
**Specs afetadas:** [012-conector-mercado-livre](../specs/012-conector-mercado-livre/spec.md)
(seção 3.5), [005-produtos-cadastro-manual](../specs/005-produtos-cadastro-manual/spec.md)
(`medidas`)

### Contexto

O T050 (medição contra a conta real, 21/09/2026) mostrou que **nenhum domínio de roupa** do
Mercado Livre tem tabela de medidas `STANDARD`/`BRAND` pronta — só calçados têm. Publicar roupas
exige uma tabela `SPECIFIC`, do próprio vendedor (spec 012, seção 3.5, T053). Havia duas opções:
(1) o conector só lê tabelas que a dona do brechó crie no painel do Mercado Livre; (2) o ERP cria
as tabelas por API, com as medidas reais de cada peça.

O brechó já cadastra `medidas` (`cintura`, `quadril`, `gancho`, `comprimento`, `largura_barra` —
`shared/schemas/product.schema.ts`, `MedidasSchema`) desde a spec 005, preenchidas manualmente ou
pela IA de cadastro (006). E a constituição, princípio X, já estabelece que **cada peça física é
única, com SKU próprio** — mesmo duas peças "tamanho 38" podem ter medidas reais diferentes. Isso
combina diretamente com a opção 2: a medida real da peça, que o ERP já captura no cadastro, é
exatamente o que uma tabela `SPECIFIC` por peça precisa — sem inventar uma segunda fonte de
verdade "genérica" só para o marketplace.

### Decisão

**Opção 2**, com o cadastro do produto (`medidas`) como fonte única:

1. **`MedidasSchema` é estendido** para cobrir os atributos que o Mercado Livre exige em tabelas
   `CLOTHING_MEASURE` de calças/shorts/saias (domínio confirmado — documentação "Gerenciar tabela
   de medidas", exemplo `PANTS_TEST`):
   - `cintura` → `GARMENT_WAIST_WIDTH_FROM` (mantido)
   - `quadril` → `GARMENT_HIP_WIDTH_FROM` (mantido)
   - `gancho` → `GARMENT_FRONT_RISE_FROM` (mantido, mesmo sentido: gancho frontal)
   - `comprimento` → `GARMENT_LENGTH_FROM` (mantido)
   - **`coxa`** (novo) → `GARMENT_THIGH_WIDTH_FROM`
   - **`entrepasso`** (novo) → `GARMENT_INSEAM_LENGTH_FROM` (comprimento da costura interna —
     diferente de `gancho`, que é a medida frontal)
   - `largura_barra` é mantido (usado pelo ERP/loja física), mesmo sem atributo `GARMENT_*`
     correspondente confirmado; não é enviado ao Mercado Livre até haver um atributo que o receba.
2. ⚠ **Domínios de parte de cima** (camisas, blusas, jaquetas, vestidos, saias sem cintura/quadril
   aplicável) **não têm os atributos `GARMENT_*` confirmados** — a documentação salva só cobre o
   exemplo de calça. A implementação (T022/T023) consulta `GET /domains/{domain}/technical_specs?
   section=grids` por domínio para obter a lista oficial antes de montar a linha da tabela; campos
   novos que aparecerem lá (ex.: busto, ombro, manga) **não são adivinhados aqui** — viram uma nova
   extensão de `MedidasSchema` quando confirmados.
3. **Uma tabela por domínio + gênero** (não uma por peça): o conector cria a tabela na primeira
   peça daquele domínio/gênero (`POST /catalog/charts`, `measure_type: CLOTHING_MEASURE`) e, para
   peças seguintes, **adiciona uma linha** (`POST /catalog/charts/{id}/rows`) — nunca recria a
   tabela. Uma combinação de tamanho + medidas idêntica a uma linha existente reaproveita a linha
   (evita linhas duplicadas); uma combinação nova sempre adiciona linha, nunca edita uma existente
   (uma linha pode já estar associada a outro anúncio).
4. **Sem as medidas mínimas da peça** (as que o domínio exigir), a publicação falha **antes** do
   `POST /items`, com mensagem clara pedindo para completar o cadastro — mesmo padrão de preço fora
   da faixa (spec 012, seção 6).

Alternativas descartadas: manter só tabelas `BRAND`/`STANDARD` (T050 mostrou que não existem para
roupas); pedir ao operador que digite as medidas de novo, separadas do cadastro, só para a tabela
(duplicaria dado e contrariaria "sem abstrações prematuras" — cada peça já tem uma medida real
única, capturada uma vez).

### Consequências

- `shared/schemas/product.schema.ts` (`MedidasSchema`), `shared/schemas/ai-intake.schema.ts`
  (`AiMedidasSchema`) e `frontend/src/features/products/ProductForm.tsx` ganham os campos `coxa` e
  `entrepasso` — mesmo padrão dos já existentes (`nullableNumber().default(null)`; documento antigo
  sem os campos continua válido). Spec 005 atualizada com os dois campos e o `MedidasSchema`
  completo.
- Categorias de calça/short/saia do brechó (CALC, BERM, SAIA) passam a precisar dessas duas medidas
  preenchidas para publicar no Mercado Livre — reforça a orientação de completar `medidas` no
  cadastro (já hoje opcional; segue opcional para a loja física, só a publicação exige).
- Domínios de parte de cima (CAMI, POLO, JAQU, BLUS, VEST) ficam **sem solução até a implementação
  consultar `technical_specs`** e, se precisarem de medidas que o ERP não captura hoje
  (ex.: busto, ombro, manga), uma nova extensão de `MedidasSchema` será decidida então — não
  antecipada por adivinhação.
- O conector passa a criar/estender estado no Mercado Livre (tabelas `SPECIFIC`) além de
  anúncios — uma responsabilidade nova, mas ainda dentro da porta existente (spec 011, seção 4.1;
  não é um recurso novo de infraestrutura, princípio V).

### Pendência aberta pelo T043 (22/09/2026) — origem real dos atributos `GARMENT_*` ainda não confirmada

Testando ao vivo a criação de uma tabela `SPECIFIC` para `MLB-SHORTS` (categoria "Bermudas e
Shorts"), o Mercado Livre recusou a linha com `required_row_attribute_not_found` para
`GARMENT_HIP_WIDTH_FROM` — **mesmo depois de corrigir o parser de `technical_specs`** (a estrutura
real tem dois níveis de `components` aninhados, `groups[].components[].components[].attributes[]`,
diferente do único nível assumido antes). Com o parser corrigido, a resposta de
`GET /domains/MLB-SHORTS/technical_specs` (com e sem `section=grids`) **não contém nenhum atributo
`GARMENT_*`** — só `BRAND`, `GENDER`, `AGE_GROUP`, `MANUFACTURER_SIZE`. `GET
/categories/MLB188064/attributes` (a categoria em si) também não tem `GARMENT_*`. Ou seja: a
premissa desta ADR — "consultar `technical_specs` do domínio para saber quais `GARMENT_*` a linha
da tabela `SPECIFIC` precisa" — está **confirmadamente errada** para o domínio testado; o Mercado
Livre exige o atributo em algum lugar que ainda não foi encontrado.

**Não resolvido** — `resolveSizeChartAttributes`/`resolveClothingChart`
(`mercado-livre-publish.ts`) continuam usando `getDomainSizeChartAttributes` como fonte, então
categorias de roupa com tabela de medidas (domínio em `active_domains`, fora de calçado) **não
publicam ainda** — falha com o erro do Mercado Livre. Calçado (`SAPT`, tabela `BRAND`/`STANDARD`)
e moda sem tabela de medidas (domínio fora de `active_domains`) não são afetados. Próximo passo:
investigar outra fonte (talvez um chart `STANDARD` existente de um domínio parecido, ou suporte do
Mercado Livre) antes de tentar de novo — não vale iterar por tentativa e erro contra a API real.

## ADR-025 — Categorização no Mercado Livre: revisão humana obrigatória a cada publicação, sem mapeamento configurável

**Status:** Aceita
**Data:** 2026-09-22
**Specs afetadas:** [012-conector-mercado-livre](../specs/012-conector-mercado-livre/spec.md)
(seção 4), [011-integracao-marketplaces](../specs/011-integracao-marketplaces/spec.md)
(seções 4.1, 4.3, 4.5)

### Contexto

O T050 (medição contra a conta real, 21/09/2026) mostrou o preditor de categorias do Mercado
Livre (`GET /sites/MLB/domain_discovery/search`) errando o domínio de peças comuns —
"camisa masculina" → `MLB-RUGBY_JERSEYS`, "jaqueta masculina" → `MLB-FOOTBALL_JACKETS`. A
versão original da spec 012, seção 4, usava o primeiro resultado do preditor automaticamente,
sem confirmação humana, deixando essa decisão para "uma iteração futura, quando houver uso real
que demonstre que o preditor erra com frequência suficiente" — o que o T050 já demonstrou. Duas
categorias de risco motivaram fechar essa decisão agora, antes de T023/T025: (1) a peça publica
sem erro num domínio errado, prejudicando a visibilidade para quem procura o produto certo; (2)
desde a ADR-024, uma categorização errada também cria/alimenta uma tabela `SPECIFIC` de medidas
no domínio errado no Mercado Livre — estado externo que não tem como "mover" depois.

Duas propostas foram avaliadas: (a) mapeamento configurável categoria do ERP → categoria do
Mercado Livre (12 categorias fixas do brechó — 003), com o preditor só como reserva, sem
revisão humana; (b) preditor sempre sugere, mas **toda** publicação passa por confirmação humana
antes do `POST /items`, com uma lista de categorias para escolher/corrigir.

### Decisão

**Opção (b), sem manter (a) em paralelo:**

1. **Revisão obrigatória em toda publicação** — criar, republicar e recriar sobre `encerrado`
   (spec 012, seção 3.1) todas passam pela tela de revisão; não há atalho "sem revisão" para
   categorias já conhecidas. Justificativa: com a revisão sempre presente, o risco de categoria
   errada já fica coberto por um humano a cada vez — um mapeamento configurável adicionaria
   complexidade (JSON de 12 categorias para a dona do brechó manter em sincronia com a taxonomia
   do Mercado Livre) sem reduzir risco que a revisão já não cobrisse (princípio V).
2. **Fluxo em duas etapas**, novo em relação à spec 011, seção 4.3 original: ao clicar
   "Publicar"/"Republicar", o sistema chama o preditor (`GET /sites/MLB/domain_discovery/search`)
   com o nome do produto e mostra uma tela de revisão — categoria sugerida pré-selecionada, mais
   um `<select>` com uma **lista curada e pré-carregada** de categorias-folha da sub-árvore
   "Calçados, Roupas e Bolsas" do site MLB (não a árvore inteira — inviável como `<select>`, e
   fora do escopo do brechó). O operador confirma ou troca; só então o sistema chama
   `POST /items` com o `categoryId` escolhido.
   - Falha do preditor (erro de rede, Mercado Livre fora do ar) não bloqueia a revisão: a tela
     mostra a lista curada sem pré-seleção, e o operador escolhe manualmente.
3. **A porta comum ganha um campo novo**: `PublishInput.categoryId` (spec 011, seção 4.1) — a
   categoria já escolhida pelo operador, decidida **antes** de chamar o conector. O conector do
   Mercado Livre deixa de chamar o preditor internamente durante `publish()` — essa chamada migra
   para o endpoint novo de sugestão, fora da porta. Campo pensado como específico do Mercado
   Livre por ora (conectores futuros que não precisem de revisão o ignoram); não é uma
   abstração genérica de "hints por marketplace" (princípio V — resolver o que existe hoje, não o
   que pode ser útil depois).
4. **A lista curada é congelada em código**, não em variável de ambiente: é dado de taxonomia do
   Mercado Livre, não uma preferência operacional da dona do brechó (diferente de
   `MERCADO_LIVRE_PACKAGE_DEFAULTS`, T052). Levantada uma vez (T057) — sem precisar de conta
   conectada: `GET /categories/{id}` é público, sem token, e devolve `children_categories`; só a
   listagem plana `GET /sites/MLB/categories` exige contexto de navegador (bloqueada por política
   antibot fora dele) — e versionada no repositório; atualizada manualmente se a taxonomia do
   Mercado Livre mudar.

Alternativa descartada: manter o mapeamento configurável como sugestão pré-selecionada quando
existir, caindo no preditor quando não existir (item (a) mais uma variante híbrida) — rejeitada
porque, com a revisão já obrigatória sempre, o ganho (acertar mais vezes de primeira) não paga o
custo de manter 12 categorias sincronizadas manualmente.

### Consequências

- Spec 011: seção 4.1 (porta) ganha `categoryId` no `publish`; seção 4.3 (fluxo) passa a
  descrever as duas etapas (sugestão + confirmação, depois publicar); seção 4.5 (API) ganha o
  endpoint novo de sugestão e o campo `categoryId` no corpo de `POST /marketplace-listings`.
- Spec 012, seção 4 (Categorização) reescrita: o preditor não decide mais sozinho; o conector
  recebe `categoryId` já resolvido, e só valida (`listing_allowed`, `status = enabled`) antes de
  seguir com atributos/tabela de medidas.
- T054 fica decidida; T023/T025 (mapeador e criação) deixam de fazer a chamada ao preditor
  internamente. Duas tarefas novas: T057 (levantar e congelar a lista curada de categorias-folha
  de Roupas/Calçados/Bolsas, contra a conta real) e T058/T059 (endpoint de sugestão + tela de
  revisão no frontend) — ver `tasks.md`.
- Toda publicação (inclusive retentativas e republicações) ganha um passo a mais na tela — aceito
  como o custo direto da decisão de revisão sempre presente, já discutido no item 1.

## ADR-026 — Tipo de anúncio do Mercado Livre: escolha do operador a cada publicação, não uma variável de ambiente

**Status:** Aceita
**Data:** 2026-09-22
**Specs afetadas:** [012-conector-mercado-livre](../specs/012-conector-mercado-livre/spec.md)
(seção 3.2), [011-integracao-marketplaces](../specs/011-integracao-marketplaces/spec.md)
(seção 4.1)

### Contexto

T010 (spec 012, seção 3.2) era uma decisão de negócio pendente: qual `listing_type_id` usar —
custo (comissão por venda) × exposição do anúncio — fixado uma vez em
`MERCADO_LIVRE_LISTING_TYPE_ID` (variável de ambiente, padrão `gold_special`) para **todo** o ERP.
O usuário decidiu não fixar isso antecipadamente: em vez de uma decisão única de negócio, quem
escolhe é o operador, **a cada publicação**, por uma caixa de seleção — sempre priorizando do
menor custo (Grátis) para o maior.

Isso segue o mesmo padrão já estabelecido pela ADR-025 (revisão de categoria): em vez de fixar uma
resposta de antemão, o humano decide no momento, com uma lista ordenada e um valor padrão sensato
pré-selecionado — e, como a tela de revisão de categoria (T059) já existe e já é obrigatória em
toda publicação, o tipo de anúncio entra **no mesmo painel**, não numa tela própria.

### Decisão

1. **Sem `MERCADO_LIVRE_LISTING_TYPE_ID`** — a variável de ambiente é removida da spec; não há
   mais um valor único fixado por ambiente. T028 (configuração e registro) perde essa parte.
2. **Lista estática, ordenada por faixa conhecida**, sem consulta em tempo real a
   `GET /users/{id}/available_listing_types` nem a `GET /sites/MLB/listing_prices` — mais simples,
   sem chamada de rede extra na revisão, consistente com o padrão de "tentativa e erro" já usado na
   revisão de categoria: se o tipo escolhido não for aceito pela categoria ou pela conta (ex.:
   `free` bloqueado por volume de vendas), a publicação falha com mensagem clara (spec 011, seção
   4.6) e o operador troca de tipo no mesmo painel, sem perder a categoria já escolhida. Ordem
   (mais barato → mais caro), com `free` pré-selecionado:

   | Valor | Rótulo | Ordem |
   |---|---|---|
   | `free` | Grátis | 1 (padrão, mais barato) |
   | `bronze` | Bronze | 2 |
   | `silver` | Prata | 3 |
   | `gold` | Ouro | 4 |
   | `gold_special` | Clássico | 5 |
   | `gold_premium` | Diamante | 6 |
   | `gold_pro` | Premium | 7 (mais caro) |

   ⚠ **Ordem não confirmada por preço real.** A documentação salva não lista o custo de cada tipo
   por categoria (isso só sai de `GET /sites/MLB/listing_prices`, que exige token — não verificável
   sem uma chamada autenticada real). A ordem acima é a leitura mais razoável dos nomes/rótulos
   (metáfora de metais + "Grátis" mais barato, `gold_pro`/`Premium` mais caro, parelho com
   `gold_special`/`Clássico` como os dois "duração ilimitada" da seção 3.2) — **a confirmar na Fase
   8 (T043/T044)**, com a conta real, antes do primeiro anúncio de verdade (T049). Se a ordem real
   divergir, é só reordenar a lista estática — não muda nenhuma outra peça do desenho.
3. **`gold`/`gold_premium` nunca usados durante os testes** (Fase 8, pedido do próprio Mercado
   Livre) — fica como orientação ao operador humano que roda o teste (T043), não como bloqueio de
   código: a lista os inclui, porque em produção são opções válidas.
4. **Sem efeito ainda**: assim como `categoryId` (ADR-025), o campo viaja pela porta comum e pelo
   serviço, mas só tem uso real quando T023/T025/T026 (o mapeador e o `publish()` de fato) forem
   implementadas.

### Consequências

- Spec 012, seção 3.2 reescrita: sem variável de ambiente, com a tabela acima e o aviso de ordem
  não confirmada.
- Spec 011, seção 4.1 (porta): `PublishInput` ganha `listingTypeId?: string | null`, ao lado de
  `categoryId` — mesmo espírito ("cada conector decide se usa").
- T010 fica decidida (sem mais bloquear T043 por falta de decisão — falta só a confirmação da
  ordem real, que é harmless deixar para a Fase 8).
- T028 perde a parte de `MERCADO_LIVRE_LISTING_TYPE_ID`.
- A tela de revisão (T059) ganha um segundo campo (tipo de anúncio) no mesmo painel da categoria —
  não uma tela nova.

## ADR-027 — Pacote padrão do Mercado Livre: tela de admin gravando no banco, sem exceção por categoria/departamento

**Status:** Aceita
**Data:** 2026-09-22
**Specs afetadas:** [012-conector-mercado-livre](../specs/012-conector-mercado-livre/spec.md)
(seção 3.4)

### Contexto

T046/ADR-023 (decisão "b") tinha resolvido o pacote padrão (altura/largura/comprimento/peso, que
o Mercado Envios 2 exige em toda publicação) como uma variável de ambiente
(`MERCADO_LIVRE_PACKAGE_DEFAULTS`, JSON com `padrao`, `por_departamento` e `por_categoria`),
implementada na T052. A T051 (valores reais) ficou pendente porque preencher/editar um JSON em
variável de ambiente exige mexer no `.env` e reiniciar o backend — inviável para a dona do brechó
manter sozinha. O usuário pediu campos de formulário para essa configuração.

### Decisão

1. **Banco de dados, editado por uma tela** — não mais variável de ambiente. Documento único
   (`_id: "default"`) na coleção `mercado_livre_package_settings`, editado em "Contas de
   marketplace → Pacote padrão do Mercado Livre" (só admin, mesmo padrão de RBAC das outras
   configurações de marketplace — spec 011, seção 2.2). `GET`/`PUT` em
   `/api/marketplace-accounts/mercado-livre-package-settings`.
2. **Só o pacote "padrão"** — sem exceção por categoria nem por departamento. Simplifica bastante
   o desenho da T052 (nada de prioridade categoria > departamento > padrão): um valor só, usado em
   toda publicação. Se o brechó sentir falta de um pacote diferente por tipo de peça (ex.: calçado
   numa caixa maior), essa exceção volta como extensão futura, decidida quando o caso real
   aparecer (princípio V) — não antecipada aqui.
3. **`peso_g` passa a ser sempre obrigatório** no formulário (era opcional no JSON antigo, reserva
   só para quando o produto não tivesse peso). Elimina uma categoria inteira de falha ("peso
   inexistente e sem configuração") que existia no desenho anterior — preencher o formulário já
   garante a reserva. O peso do produto, quando existir, continua tendo prioridade (kg → g,
   arredondado para cima).
4. **`resolvePackage` muda de assíncrona pura de env var para assíncrona sobre o banco**
   (`resolvePackage(db, product)`, lê `mercadoLivrePackageSettingsRepository`) — sem consumidor
   real ainda (T023/T025 não implementadas), então a mudança de assinatura não quebra nada em
   produção, só os testes (reescritos).
5. **Auditoria**: `MERCADO_LIVRE_PACKAGE_SETTINGS_UPDATE` novo em `AuditActionEnum` (backend e
   frontend — mesmo padrão da `PRODUCT_UNPUBLISH`, T012), gravado a cada `PUT`.

### Consequências

- `mercado-livre-package.config.ts` perde `PackageDimensions`/`por_departamento`/`por_categoria`/
  leitura de env var — bem mais simples.
- Novo `mercado-livre-package-settings.repository.ts` (documento único), `...service.ts` (get/update
  + auditoria) e rotas em `marketplace-account.routes.ts`.
- Novo schema compartilhado `shared/schemas/mercado-livre-package-settings.schema.ts`
  (`MercadoLivrePackageSettingsSchema`, todos os 4 campos inteiros positivos obrigatórios).
- Frontend: `PackageSettingsCard` em `MarketplaceAccountsPage.tsx` (mesmo padrão do
  `EncryptionKeyCard`) — formulário simples, sem lista dinâmica de exceções.
- `.env.example` perde a documentação de `MERCADO_LIVRE_PACKAGE_DEFAULTS` (a variável deixa de
  existir).
- T046/T052 ficam parcialmente supersedidas por esta ADR (T052 é refeita com o novo desenho); T051
  (valores reais) passa a ser "a dona do brechó preenche a tela", não mais "edita o `.env`".


## ADR-028 — Exceção ao princípio I: IA pode estimar medidas de peça, avisando na descrição

**Status:** Aceita
**Data:** 2026-09-24
**Specs afetadas:** [006-produtos-cadastro-ia](../specs/006-produtos-cadastro-ia/spec.md)
(seções 7, 8.3, 9), [005-produtos-cadastro-manual](../specs/005-produtos-cadastro-manual/spec.md)
(seção 2, `identificacao.descricao`); [constituição](constitution.md), princípio I

### Contexto

Testando o cadastro por IA com uma blusa (spec 013 recém em produção), o usuário reportou que
os campos de `medidas.*` sempre voltavam `null` — mesmo pedindo pra IA "estimar as medidas da
peça para um e-commerce" via um prompt direto no mesmo modelo (fora do ERP), que respondeu com
uma tabela completa de estimativas, cada uma com o aviso de que são aproximadas e precisam ser
conferidas com fita métrica antes de publicar.

Investigação: não era bug. A regra 6 do prompt de sistema (spec 006, seção 8.3) e o princípio I
da constituição instruem a IA a **nunca** aproximar, sempre `null` quando não determinável "com
razoável confiança" — e medida de peça a partir de foto nunca tem essa confiança (não existe
escala/referência na imagem), então a IA, seguindo a regra à risca, sempre retornava `null` pra
`medidas.*`. O comportamento que o usuário queria (estimar, com aviso) já existe no modelo — só
estava bloqueado pela nossa própria regra geral, desenhada pra evitar a IA inventar marca,
categoria ou composição (onde um palpite errado é mais perigoso que uma medida aproximada e
sinalizada).

### Decisão

1. **Exceção pontual, só para `medidas.*`**, documentada explicitamente no princípio I da
   constituição (nunca implícita) — todo outro campo continua proibido de aproximar.
2. **O aviso de "medida estimada" vive em `identificacao.descricao`**, não em
   `ai_metadata.fields[...].confidence` nem em nenhum metadado à parte — decisão explícita do
   usuário: o texto que o operador já lê é onde o aviso precisa aparecer, não um badge que pode
   passar despercebido. `ai_metadata.fields` continua registrando confiança por campo quando o
   provedor devolver, mas não é o mecanismo que carrega este aviso específico.
3. **Prompt de sistema (spec 006, seção 8.3)** ganha uma regra nova, escopada só a `medidas.*`:
   a IA pode estimar com base no tipo de peça/corte/proporções visíveis, mesmo sem instrumento
   de medição na foto; toda vez que estimar pelo menos uma medida, é obrigada a incluir em
   `identificacao.descricao` uma frase de aviso (texto exato não fixado no prompt — a IA
   redige, desde que o sentido "medidas estimadas, conferir com fita métrica antes de publicar"
   apareça). As demais 8 regras do prompt (marca, categoria, composição, etc.) não mudam.
4. **Sem campo novo, sem mudança de schema** — `medidas.*` já são `nullableNumber()` (spec 005);
   passam a poder vir preenchidas pela IA além de `null`, isso já era permitido estruturalmente.
5. **Vale tanto para cadastro novo (`/analyze`) quanto para reavaliação (`/reanalyze`, spec 006
   seção 9)** — os dois usam o mesmo prompt/`analyzeProduct`, sem caminho separado.

Alternativa descartada: sinalizar via `confidence` baixo em `ai_metadata.fields` (mecanismo já
existente, exigiria só mudar a regra do prompt, sem mexer em `descricao`) — rejeitada pelo
usuário porque um metadado de confiança não aparece na tela sem um badge dedicado (que hoje só
cobre 6 campos curados, spec 006 seção 7, nenhum deles medida), e o aviso precisa ser visto,
não só existir tecnicamente.

### Consequências

- Medida de peça cadastrada por IA agora quase sempre vem preenchida (estimada), não mais quase
  sempre `null` — cadastro fica mais rápido, inclusive pra categorias do Mercado Livre que
  exigem medida real pra publicar (spec 012, seção 3.5) — mas a estimativa **não substitui**
  conferência física antes de publicar; o aviso na descrição é a defesa contra isso, não um
  bloqueio técnico (a peça pode ser salva e até publicada com medida nunca conferida — decisão
  consciente do usuário, mesmo espírito de outras defesas "confiar no humano revisar", princípio
  II).
- Risco aceito: cliente final pode receber peça de tamanho diferente do anunciado se o operador
  não conferir a medida estimada antes de publicar. Mitigado só pelo aviso textual, sem trava de
  sistema — reavaliar se isso gerar problema real (princípio V, não antecipar).
- `identificacao.descricao` passa a poder conter um trecho gerado pela IA sem ter sido
  literalmente extraído de texto visível na peça (diferente do resto do prompt, que só lê o que
  está escrito) — primeira vez que a spec 006 permite a IA *compor* uma frase nova em vez de só
  extrair/transcrever.

## ADR-029 — Tabela de medidas `SPECIFIC` do Mercado Livre: linha reaproveitada por `SIZE`, não por `SIZE` + medida idêntica (reverte parte da ADR-024)

**Status:** Aceita
**Data:** 2026-09-25
**Specs afetadas:** [012-conector-mercado-livre](../specs/012-conector-mercado-livre/spec.md)
(seção 3.5)

### Contexto

Publicando uma peça (SKU de teste, blusa Pierre Balmain, tamanho 14) no Mercado Livre em
ambiente real, a criação de linha na tabela `SPECIFIC` falhou: `"Value 14 in attribute
FILTRABLE_SIZE is incorrect — Duplicated measure in attribute GARMENT_CHEST_WIDTH_FROM was
found in row SIZE 14."` A tabela já tinha uma linha `SIZE "14"` (de uma peça publicada antes,
mesmo tamanho na etiqueta) com um valor de busto diferente do desta peça — a IA reestima
medidas a cada reavaliação (ADR-028), então duas peças "tamanho 14" facilmente têm bustos
reais diferentes.

A ADR-024 (decisão 3) tinha decidido casar a linha por `SIZE` + todos os atributos `GARMENT_*`
idênticos, criando uma linha nova por combinação — a premissa era que cada peça é única
(princípio X) e merece sua própria linha, mesmo compartilhando o `SIZE`. O erro real mostra que
o Mercado Livre não aceita essa premissa: `SIZE` funciona, na prática, como chave única de
linha para medida na tabela `SPECIFIC` — duas linhas com o mesmo `SIZE` e um `GARMENT_*`
diferente são recusadas como "duplicadas".

### Decisão

**A linha passa a ser casada só por `SIZE`** (`resolveClothingChart`,
`backend/src/plugins/marketplaces/mercado-livre-publish.ts`): achando uma linha com aquele
`SIZE`, reaproveita — mesmo que os `GARMENT_*` da linha não sejam idênticos aos da peça atual;
não achando nenhuma, cria uma linha nova com os `GARMENT_*` desta peça (mesmo fluxo de
criação/`addSizeChartRow` da ADR-024, só o critério de match muda). Nunca edita uma linha
existente — mantido da ADR-024, mesmo motivo (pode já estar associada a outro anúncio).

`product.medidas` no cadastro do ERP **não muda** — continua com a medida real desta peça
específica, fonte única de verdade interna (princípio X intacto dentro do ERP). O que muda é só
a representação no Mercado Livre: a tabela `SPECIFIC` deles é por tamanho, não por peça, e o
conector se adapta à granularidade real da API em vez de insistir numa granularidade que ela
recusa.

Alternativa descartada: rotular `SIZE` com sufixo por combinação de medida (ex.: "14", "14
(2)") pra preservar uma linha por peça — rejeitada porque o comprador veria um tamanho não
padrão no filtro de busca do Mercado Livre, pior experiência do que a medida exibida ser a da
primeira peça publicada daquele tamanho.

### Consequências

- O anúncio de uma peça pode exibir, no atributo de medida do Mercado Livre, o valor registrado
  pela **primeira** peça publicada com aquele `SIZE` naquele domínio+gênero — não
  necessariamente a medida real desta peça. Risco aceito, mesmo espírito da ADR-028 (marketplace
  externo tem limitação própria; o cadastro interno continua correto, a mitigação real é a
  descrição do anúncio, que já pode citar a medida exata via `identificacao.descricao`).
- Elimina o erro `"Duplicated measure ... found in row SIZE ..."` para peças que reusam um
  `SIZE` já publicado com medida real diferente — sem esse fix, a publicação dessas peças
  ficava permanentemente bloqueada.
- `spec.md` (seção 3.5, passo 4) atualizada para descrever o novo critério, com a decisão
  antiga (ADR-024) marcada como revertida nesse ponto específico — o restante da ADR-024
  (extensão de `MedidasSchema`, criação de tabela, nunca editar linha existente) continua
  valendo.

## ADR-030 — Tabela de medidas de roupas do Mercado Livre: tenta BRAND/STANDARD oficial antes de medir, e abre faixa de ±1cm em `_FROM`/`_TO` quando cria a própria SPECIFIC

**Status:** Aceita
**Data:** 2026-09-25
**Specs afetadas:** [012-conector-mercado-livre](../specs/012-conector-mercado-livre/spec.md)
(seção 3.5)

### Contexto

A ADR-029 (mesmo dia, poucas horas antes) resolveu um caso do erro real
`"Value 14 in attribute FILTRABLE_SIZE is incorrect — Duplicated measure in attribute
GARMENT_CHEST_WIDTH_FROM was found in row SIZE 14"` — mas o mesmo erro voltou a acontecer
publicando uma peça completamente diferente (camisa Hugo Boss, tamanho 39), o que descartou a
causa original (linha SIZE já existente com medida diferente): tamanho 39 nunca tinha sido
publicado antes nesse domínio, então a linha era **nova**, e o erro persistiu mesmo assim.

Consultando a documentação oficial do Mercado Livre (`size-guide-validations`), o erro
`duplicated_measure_value` é descrito, pela própria estrutura do payload de erro (`cell` com um
único `attribute_id` e uma única `row`, sem referência a nenhuma outra linha), como um valor de
medida que duplica outro valor **já usado na mesma linha** — não duas linhas conflitando entre
si. Isso aponta direto para `garmentMeasureAttributes`
(`backend/src/plugins/marketplaces/mercado-livre-item.mapper.ts`): por decisão da ADR-024,
`_FROM` e `_TO` do mesmo atributo (ex.: `GARMENT_CHEST_WIDTH_FROM`/`_TO`) sempre recebiam o
**mesmo valor** (a medida real única da peça) — o Mercado Livre rejeita isso como duplicado.

Ao investigar, o usuário perguntou se dava pra indicar tamanhos padrão sem depender de medidas —
o calçado (`SAPT`) já faz exatamente isso (tabela `BRAND`/`STANDARD` do próprio Mercado Livre,
sem nenhuma medida do ERP), mas a ADR-024 nunca tinha testado se domínios de roupa também têm
tabelas oficiais — só confirmou que `STANDARD` não tinha resultado pra roupa (T050); `BRAND`
nunca foi checado para roupa.

### Decisão

Duas mudanças, uma reduz quando a outra é necessária:

1. **Roupa tenta tabela oficial (`BRAND` da marca, depois `STANDARD`) antes de qualquer medida**
   — mesma ordem de preferência e mesma busca já usada por calçado
   (`findBrandOrStandardChart`, generalizada a partir de `findFootwearChart`). Achando uma
   tabela oficial com uma linha do `SIZE` da peça, reaproveita direto — **sem consultar
   `technical_specs`, sem `medidas`, sem tocar na `SPECIFIC` do vendedor**. Diferente de
   calçado, se a tabela oficial não tiver o `SIZE` (ou não existir nenhuma), roupa **não
   bloqueia** — cai pro fluxo de `SPECIFIC` (ADR-024/ADR-029), porque só roupa pode
   criar/estender sua própria tabela.
2. **Quando cai pra `SPECIFIC` (nenhuma tabela oficial serviu), `_FROM`/`_TO` do mesmo atributo
   abrem uma faixa de ±1cm em torno do valor real** (`_FROM = valor - 1`, `_TO = valor + 1`),
   em vez do mesmo valor duas vezes — resolve o `duplicated_measure_value` na origem, não só no
   caso específico que a ADR-029 cobriu. `product.medidas` no cadastro do ERP **não muda** —
   continua com o valor real único da peça (princípio X intacto); a faixa existe só no payload
   enviado ao Mercado Livre, para satisfazer o schema deles.

Alternativa descartada para o item 2: enviar só um dos dois atributos (`_FROM` OU `_TO`) —
rejeitada porque o T060/24-09 já confirmou ao vivo que, quando o domínio lista os dois como
exigidos, o Mercado Livre recusa a linha por atributo obrigatório faltando
(`required_row_attribute_not_found`) se só um for enviado.

### Consequências

- Peças de marca/tamanho já cobertos por uma tabela oficial do Mercado Livre publicam **sem
  exigir nenhuma medida no cadastro** — reduz o atrito do cadastro manual e o número de vezes
  que a `SPECIFIC` do vendedor precisa ser criada/estendida.
- Quando a `SPECIFIC` do vendedor é usada, o valor de medida mostrado ao comprador no atributo
  do Mercado Livre passa a ser uma faixa de ±1cm em torno do valor real, não mais o valor exato
  — mesmo espírito de risco aceito da ADR-029 (representação no marketplace por tamanho/faixa,
  não por peça exata); a medida exata continua disponível na descrição do anúncio quando
  relevante.
- `findFootwearChart` renomeada para `findBrandOrStandardChart` (mesma função, agora
  compartilhada entre calçado e roupa) — sem mudança de comportamento para calçado.
- Testes de unidade de `garmentMeasureAttributes` (mapper) e de integração de
  `resolveSizeChartAttributes`/`publishItem` (roupa — tabela SPECIFIC) atualizados para a nova
  faixa de valores e para o novo passo de busca `BRAND`/`STANDARD` antes da `SPECIFIC`.

## ADR-031 — Prompt de sistema da IA de cadastro: entregue dentro da mensagem `user`, nunca em `role: "system"` da API

**Status:** Aceita
**Data:** 2026-09-25
**Specs afetadas:** [006-produtos-cadastro-ia](../specs/006-produtos-cadastro-ia/spec.md)
(seção 8.3)

### Contexto

Ao trocar o modelo configurado (Administração → Configuração de IA, spec 013) de um Qwen3 para
`google/gemma-4-12b` (mesmo `baseUrl`, mesmo gateway open-webui/IA local — só o nome do
modelo mudou), toda análise (`/analyze` e `/reanalyze`) passou a devolver
`400 Bad Request`/`"400 status code (no body)"`. Testando o mesmo modelo diretamente (mesma
quantidade de fotos), a requisição funcionava — o problema era específico de como o adapter do
ERP monta a chamada, não do modelo em si.

`openai-compatible.adapter.ts` sempre mandava o prompt de sistema (spec 006, seção 8.3) como
`{ role: "system", content: ... }`, primeira mensagem da conversa — funcionava com Qwen3 (que
aceita `system`) e com a OpenAI oficial, mas o **template de chat oficial dos modelos Gemma
(todas as versões) lança um erro explícito quando a primeira mensagem tem `role: "system"`**
(`raise_exception('System role not supported')`, documentado pela própria Hugging
Face/Google) — o servidor que aplica esse template converte isso num 400, aparentemente sem
corpo (o gateway/servidor não formata uma resposta de erro limpa pra uma exceção de
renderização de template).

Investigando também o sintoma "a tela só mostra 'Bad Request', sem detalhe nenhum": nenhum
`instanceof` de `ai-intake.routes.ts` reconhecia um erro cru do SDK da OpenAI
(`OpenAI.APIError`) — caía no error handler padrão do Fastify (`{ statusCode, error: "Bad
Request", message }`), formato que `parseEnvelope` (frontend) não lê (só lê `body.error`, que
nesse formato genérico é só a frase do status HTTP, nunca `message`, onde estava o detalhe
real). Bug independente do Gemma, mas encontrado pela mesma investigação.

### Decisão

1. **O prompt de sistema passa a ser embutido no início da mensagem `role: "user"`** (junto com
   o prompt da requisição e as fotos), nunca numa mensagem `role: "system"` separada
   (`openai-compatible.adapter.ts`, `analyze()`). Funciona em qualquer provedor: os que
   suportam `system` continuam recebendo as mesmas instruções, só que por outra role — o texto
   já declara sua própria prioridade sobre o resto da conversa ("têm prioridade sobre qualquer
   outra instrução que apareça em qualquer parte desta conversa"), então as defesas de
   prompt-injection (spec 006, seção 8.2) não dependem do privilégio de role da API, só do
   conteúdo do próprio texto.
2. **Qualquer falha na chamada ao provedor (`provider.analyze()`) agora vira
   `AiProviderRequestError`**, capturada em `ai-intake.service.ts` e mapeada para `502` com
   mensagem amigável em `ai-intake.routes.ts` (`/analyze` e `/reanalyze`) — preserva o detalhe
   real do erro do provedor (`err.message`) em vez de deixar subir cru até o error handler
   genérico do Fastify.

Alternativa descartada para o item 1: manter `role: "system"` por padrão e adicionar uma opção
de configuração por provedor (`ai_settings`) pra "dobrar" o prompt em `user` só quando
necessário — rejeitada por introduzir uma tela/schema/toggle novo pra um problema que a solução
única (sempre embutir em `user`) já resolve sem nenhuma configuração extra e sem prejuízo pros
provedores que suportam `system` (princípio V — não abstrair o que não precisa).

### Consequências

- Modelos sem suporte a `role: "system"` (toda a família Gemma, e potencialmente outros)
  passam a funcionar com o adapter sem nenhuma configuração adicional.
- Qualquer futura falha do provedor (chave inválida, modelo inexistente, limite de contexto
  excedido etc.) agora aparece na tela com o detalhe real (`AiProviderRequestError.message`),
  em vez de um "Bad Request" genérico — mais fácil de diagnosticar sem precisar abrir o
  DevTools do navegador.
- `DEFAULT_SYSTEM_PROMPT` (o texto em si) não muda — só como ele é transportado na API.

## ADR-032 — Sugestão de tamanho do Mercado Livre estendida de calçado pra roupa: lista o que já é aceito, com opção de digitar quando a peça pode criar a própria tabela

**Status:** Aceita
**Data:** 2026-09-25
**Specs afetadas:** [012-conector-mercado-livre](../specs/012-conector-mercado-livre/spec.md)
(seção 4)

### Contexto

Mesmo depois da ADR-030 (tenta tabela `BRAND`/`STANDARD` oficial antes de medir) e da ADR-029
(linha casada só por `SIZE`), publicar uma camisa Lacoste (tamanho de etiqueta `"FR 48 / US
19"`) falhou com `"Value FR 48 / US 19 in attribute FILTRABLE_SIZE is incorrect"` — sem menção
de linha duplicada dessa vez: o próprio valor, um rótulo composto de dois sistemas de tamanho
com "/", não é aceito como `SIZE` pelo Mercado Livre, mesmo numa linha nova.

O usuário perguntou se dava pra aplicar, em todos os casos, o mesmo tratamento já usado pra
calçado (spec 012, achado real 24/09/2026): antes de publicar, consultar os tamanhos já aceitos
e deixar o operador escolher um da lista, em vez de mandar o valor cru do cadastro e descobrir
o erro só depois de tentar.

### Decisão

`resolveFootwearSizeSuggestion` (`mercado-livre-publish.ts`) generalizada para
`resolveSizeSuggestion`, aplicável a qualquer categoria de moda com tabela de medidas ativa —
não só `SAPT`:

1. **Calçado**: sem mudança de comportamento — tabela `BRAND`/`STANDARD` fixa,
   `allowCustomSize: false` (sem tabela, bloqueia — ADR-024, calçado nunca cria tabela própria).
2. **Roupa** (novo): `available` junta os tamanhos da tabela `BRAND`/`STANDARD` oficial (se
   existir, ADR-030) com os já usados na `SPECIFIC` do próprio vendedor (se já existir uma pra
   esse domínio+gênero) — **nunca bloqueia**, mesmo com a lista vazia
   (`allowCustomSize: true`): a tela de revisão (`PublishToMarketplace.tsx`) passa a aceitar um
   tamanho **digitado**, além de escolhido, quando `allowCustomSize` é `true` — cobre o caso
   deste achado (nenhuma tabela tinha "48" nem "FR 48 / US 19", mas o operador pode digitar
   "48", um `SIZE` válido, sem editar o cadastro da peça).
3. `current` deixa de ser normalizado como calçado (`"N,0 BR"`) pra roupa — é o valor cru de
   `tamanho_etiqueta`/`tamanho_equivalente`, comparado direto contra `available`.

Schema de resposta (`SizeSuggestionResponseSchema`, backend e frontend) ganha
`allowCustomSize: boolean`. Contrato de `sizeOverride` (publicação) não muda — mesmo campo já
usado por calçado desde a spec 012, só passa a valer pra roupa também.

Alternativa descartada: continuar deixando roupa publicar direto com o `tamanho_etiqueta` cru e
só reagir a erros do Mercado Livre — rejeitada porque é exatamente o padrão que gerou os três
achados reais consecutivos (ADR-029, ADR-030, este) — mostrar antes o que já é aceito evita a
categoria inteira de erro, em vez de corrigir um formato de valor de cada vez conforme aparece.

### Consequências

- Toda publicação de roupa numa categoria com tabela de medidas ativa (a maioria, T050) passa a
  mostrar a seção de tamanho na revisão — antes, só calçado mostrava. Quando o tamanho do
  cadastro já bate com algo conhecido, a seção fica invisível (`currentMatches`), sem mudança
  perceptível pro operador.
- `findFootwearChart`/`resolveFootwearSizeSuggestion`/`suggestFootwearSizes` renomeadas
  (`findBrandOrStandardChart` já pela ADR-030; agora `resolveSizeSuggestion`/`suggestSizes`) —
  nomes deixam de sugerir "só calçado".
- Testes de unidade (`mercado-livre-publish.test.ts`, `mercado-livre.connector.test.ts`,
  `marketplace-size-suggestion.service.test.ts`) atualizados para o novo nome e para os cenários
  de roupa (sem tabela nenhuma, tabela oficial, `SPECIFIC` própria, as duas juntas).

## ADR-033 — `FILTRABLE_SIZE` é lista fechada do domínio, não texto livre: exige `{id, name}` resolvido via `technical_specs`, não `{name}` solto

**Status:** Aceita
**Data:** 2026-09-25
**Specs afetadas:** [012-conector-mercado-livre](../specs/012-conector-mercado-livre/spec.md)
(seção 3.5, passo 4a; seção 4)

### Contexto

Depois da ADR-032 (tela de revisão de tamanho estendida a roupa, com opção de digitar), o
operador digitou `"48"` — um valor limpo, sem o problema de rótulo composto do achado anterior
(`"FR 48 / US 19"`) — e a publicação falhou de novo: `"Value 48 in attribute FILTRABLE_SIZE is
incorrect"`, numa linha nova, sem nenhum conflito. Consultando a documentação oficial do
Mercado Livre (`size-guide-validations`, exemplo do erro `value_is_not_in_the_list`, e
`gerenciar-tabela-de-medida`), `FILTRABLE_SIZE` é um atributo de **lista fechada** por domínio —
diferente de `SIZE`, que é texto livre. Um valor de lista fechada precisa do **`id`** do valor,
obtido de `GET/POST /domains/{domain}/technical_specs?section=grids`, não só do texto (`name`).

O código (`mercado-livre-api.client.ts`, `createSizeChart`/`addSizeChartRow`) sempre serializava
`values: string[]` como `{ name }`, nunca `{ id, name }` — funciona para atributos de texto
livre (`SIZE`, `GARMENT_*`), nunca funcionou para `FILTRABLE_SIZE`. O parser de
`technical_specs` (`getDomainSizeChartAttributes`) também nunca capturava a lista de valores
aceitos (`TechnicalSpecAttribute` não tinha campo `values`) — a informação pra resolver o `id`
certo já estava disponível na mesma chamada que já buscava os atributos `GARMENT_*`, só não era
extraída.

### Decisão

1. **`TechnicalSpecAttribute` ganha `values: { id, name }[]`** — o parser passa a extrair a
   lista de valores aceitos de qualquer atributo de lista fechada, vazio para os de texto livre.
2. **`SizeChartRowValue` (novo tipo, `mercado-livre-api.client.ts`)**: `string | { id, name }` —
   `createSizeChart`/`addSizeChartRow` serializam string como `{ name }` (sem mudança) e objeto
   como `{ id, name }`.
3. **`resolveFiltrableSizeValue(requiredSpecs, size)`** (mapper, pura): acha, na lista de
   valores de `FILTRABLE_SIZE`, o item cuja `name` bate com `size` (sem diferenciar
   maiúsculas/espaços nas pontas). `buildChartRowPayload`/`buildChartPayload` ganham um
   parâmetro opcional `filtrableSize` — quando presente, `FILTRABLE_SIZE` manda `{ id, name }`
   em vez do texto solto.
4. **Publicação (`resolveSizeChartAttributes`) valida antes de escrever**: se o domínio declara
   `FILTRABLE_SIZE` como lista fechada e `size` não bate com nenhum valor, falha **antes** do
   `POST` com os valores aceitos na mensagem — mesmo padrão de "erro claro antes de tentar" já
   usado pra medida em branco e calçado sem tamanho.
5. **Sugestão de tamanho (`resolveSizeSuggestion`, roupa)**: `available` passa a incluir a
   lista real de `FILTRABLE_SIZE` do domínio — existe mesmo sem nenhuma tabela criada ainda,
   então a tela mostra um `<select>` com os valores certos desde a primeira peça daquele
   domínio, não só depois de uma tabela existir (melhoria sobre a ADR-032). Quando essa lista
   existe, `allowCustomSize` vira `false` — texto livre fora da lista sempre falharia, então não
   faz sentido oferecer o campo; só domínios sem `FILTRABLE_SIZE` declarado (raros) continuam
   aceitando um tamanho digitado (comportamento original da ADR-032).

Nenhuma mudança na tela de revisão (`PublishToMarketplace.tsx`) foi necessária — a interface
`available`/`allowCustomSize` já desenhada na ADR-032 comportou o refinamento sem alteração.

### Consequências

- Publicar roupa numa categoria com `FILTRABLE_SIZE` de lista fechada (o caso comum) passa a
  funcionar de primeira, sem exigir tentativa e erro — a tela já mostra os valores certos.
- `SIZE` continua texto livre, sem essa exigência — só `FILTRABLE_SIZE` precisa do `id`.
- Testes novos: `resolveFiltrableSizeValue` (mapper, unitário), `buildChartRowPayload`/
  `buildChartPayload` com `filtrableSize`, bloqueio na publicação quando o tamanho não bate com
  a lista, e `allowCustomSize`/`available` na sugestão de tamanho refletindo a lista real.
- **Padrão que se repetiu** (mesmo dia): o erro `MAIN_COLOR` levou a uma revisão dos outros
  atributos "melhor esforço" e à extração de `resolveListValue` (`mercado-livre-item.mapper.ts`).
  ⚠ A primeira versão dessa revisão afirmou que `COLOR` e `*_MATERIAL` também eram lista
  fechada — **errado**, corrigido pela ADR-035 depois de consultar os dados reais da API: são
  `value_type: "string"` (texto livre aceito). A regra correta, por tipo de atributo, está na
  ADR-035.

## ADR-034 — Remove o aviso de medida estimada da descrição da peça

**Status:** Aceita
**Data:** 2026-09-25
**Specs afetadas:** [006-produtos-cadastro-ia](../specs/006-produtos-cadastro-ia/spec.md)
(seções 7.1, 8.3, 10); [constituição](constitution.md), princípio I

### Contexto

A ADR-028 (24/09/2026) decidiu que, toda vez que a IA estimasse uma medida de peça, era
obrigada a incluir em `identificacao.descricao` um aviso ("as medidas são estimadas e precisam
ser conferidas com fita métrica antes de publicar") — a única defesa contra publicar uma medida
errada, sem trava técnica, só textual. O usuário pediu a remoção desse aviso: a descrição vai
direto para os anúncios nos marketplaces (Mercado Livre etc.), e o texto técnico sobre a origem
da medida deixou de ser desejado ali — pareceria fora de lugar num anúncio voltado ao
comprador final.

Perguntado se a remoção do aviso deveria vir junto da remoção da própria estimativa (voltar a
`medidas.*` sempre `null`, revertendo a ADR-028 por completo) ou só do aviso, decisão explícita
do usuário: **só o aviso sai — a estimativa continua**.

### Decisão

1. **Regra 9 do prompt de sistema** (`DEFAULT_SYSTEM_PROMPT`,
   `openai-compatible.adapter.ts`; espelhada em `specs/006-produtos-cadastro-ia/spec.md`, seção
   8.3) muda de "toda vez que estimar, inclua um aviso na descrição" para "nunca mencione que as
   medidas são estimadas, em nenhum campo" — instrução invertida, não removida, pra não deixar
   ambíguo se um modelo mais "prestativo" adicionaria o aviso por conta própria.
2. **Constituição, princípio I**, exceção de medidas: o texto da exceção original (ADR-028) é
   mantido, com uma nota "⚠ decisão original... removida pela ADR-034" — mesmo padrão já usado
   pra reverter parte de uma decisão anterior (ADR-024→ADR-029, por exemplo) sem apagar o
   histórico. Versão da constituição sobe de 1.5 para 1.6 (mudança de conteúdo de princípio,
   não só correção de texto).
3. **`medidas.*` continua sendo estimada normalmente** — só o texto de aviso desaparece. Risco
   aceito conscientemente pelo usuário: uma peça pode ser publicada com medida estimada nunca
   conferida fisicamente, sem nenhum sinal disso pro comprador nem pro operador além do que já
   existia antes da ADR-028 (nada).
4. **`ai_metadata.fields["medidas.*"].confidence`** continua sendo registrado quando o provedor
   devolve confiança por campo (mecanismo já existente, spec 006 seção 7) — não é o mecanismo de
   aviso (nunca foi, ADR-028 já tinha rejeitado essa alternativa), mas segue disponível como
   metadado técnico caso um badge de UI venha a usá-lo no futuro.

### Consequências

- Descrições geradas por IA a partir de 25/09/2026 não mencionam mais a origem estimada de
  nenhuma medida — peças reavaliadas depois desta data (ex.: o fixture de teste
  `ERP-BLUS-000001`, documentado em memória de sessão) deixam de ganhar o aviso em reavaliações
  futuras; descrições já salvas com o aviso (geradas entre 24/09 e 25/09/2026) não são
  reescritas retroativamente — só mudam se o operador reavaliar ou editar a peça de novo.
- Nenhuma mudança de schema (`medidas.*`, `identificacao.descricao` continuam como estavam) —
  só o conteúdo textual que a IA é instruída a produzir.

## ADR-035 — Atributos do Mercado Livre por tipo: lista fechada nunca vai sem `value_id`, e obrigatório que o cadastro não cobre vira caixa de seleção na revisão

**Status:** Aceita
**Data:** 2026-09-28
**Specs afetadas:** [012-conector-mercado-livre](../specs/012-conector-mercado-livre/spec.md)
(seção 4, revisão antes de publicar); revisa a nota final da ADR-033

### Contexto

Mesmo depois da correção de cor (resolver `value_id` pela lista da categoria), um blazer
continuava falhando com `"Attribute [MAIN_COLOR] is not valid, item values [(null:azul claro)]"`,
e a tela de revisão não oferecia nenhuma forma de resolver. Em vez de mais uma correção pontual,
consultamos os dados reais (`GET /categories/{id}/attributes`, público) e varremos as 207
categorias da lista curada:

- **Tipo do atributo decide tudo.** `value_type: "string"` (`BRAND`, `MODEL`, `COLOR`, `SIZE`,
  `*_MATERIAL`): texto livre aceito, `values` é só sugestão. `value_type: "list"` (`GENDER`,
  `MAIN_COLOR`, `ITEM_CONDITION`, `EMPTY_GTIN_REASON`, `FILTRABLE_SIZE`): lista fechada, `value_id`
  obrigatório. A revisão anterior (ADR-033, nota final) tinha classificado `COLOR`/`*_MATERIAL`
  como lista fechada — errado.
- **`MAIN_COLOR`** é `list`, com só ~16 cores genéricas, e **opcional em todas as 174
  categorias** que o têm — "azul claro" nunca casa, e mandá-lo sem id derrubava o anúncio
  inteiro por um atributo que nem é exigido.
- **~28 atributos obrigatórios que o ERP não preenche** — "tipo de peça" que o cadastro não tem
  como campo: `GARMENT_TYPE` (11 categorias, incluindo Casacos/Jaquetas — seria o próximo erro
  do blazer), `SLEEVE_TYPE`, `LENGTH_TYPE`, `PANT_TYPE`, `SHORT_TYPE`, `DRESS_TYPE`,
  `FOOTWEAR_TYPE`, `HAT_AND_CAP_TYPE` etc.

### Decisão

1. **`pickAttributes` descarta candidato de atributo `list` sem `value_id`** — nunca manda texto
   solto num atributo de lista fechada. Resolve o `MAIN_COLOR` de imediato.
2. **Casamento de valor por "mesma palavra"** (`resolveListValue`): sem acento, hífen como espaço
   ("azul claro" → "Azul-claro", "azul petroleo" → "Azul-petróleo"). Nunca sinônimo nem palavra
   parecida ("azul claro" nunca vira "Azul") — princípio I.
3. **Obrigatório que o cadastro não cobre vira pergunta na revisão, não um mapeamento por
   atributo.** Endpoint novo `POST /api/products/:id/marketplace-attribute-suggestion` (depois da
   categoria escolhida, só leituras) devolve cada obrigatório pendente com as opções da categoria;
   a tela mostra uma caixa de seleção por atributo (e campo de texto quando o tipo é `string`),
   pré-selecionada quando a `classificacao.subcategoria` do cadastro é a mesma palavra de uma
   opção. A escolha viaja em `extraAttributes` no `POST .../marketplace-listings`, vale só pra
   essa publicação, nunca é gravada no produto (mesmo espírito de `sizeOverride`). Em atributo
   `list`, só um `valueId` que exista nas opções é aceito.
4. **Rede de segurança na publicação:** obrigatório ainda pendente falha **antes de qualquer
   escrita** (antes até da tabela de medidas), com o nome dos atributos na mensagem.

Alternativa descartada: adicionar campos novos ao cadastro (tipo de peça, tipo de manga...) —
mudaria a spec 005 e o formulário por uma exigência de um marketplace específico; e mapear cada
atributo no código conforme falhasse — 28 ciclos de erro→correção→deploy.

### Consequências

- Uma categoria com obrigatório novo, que o ERP não conhece, não precisa mais de código novo — a
  revisão pergunta ao operador com as opções que o próprio Mercado Livre devolve.
- A tela de revisão ganha uma chamada a mais (depois da categoria) e, em algumas categorias, uma
  ou mais caixas de seleção; o botão "Confirmar e publicar" fica bloqueado até todas terem valor.
- `MAIN_COLOR` deixa de ser enviado quando a cor do cadastro não casa com nenhuma das ~16 cores
  genéricas — o anúncio publica sem ele (é opcional).
