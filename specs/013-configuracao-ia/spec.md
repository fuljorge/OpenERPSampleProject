# Spec 013 — Configuração do Provedor de IA

**Domínio:** AI Settings
**Fase:** 2 — Cadastro inteligente
**Status:** Draft
**Depende de:** [001-autenticacao](../001-autenticacao/spec.md), [006-produtos-cadastro-ia](../006-produtos-cadastro-ia/spec.md),
[008-auditoria](../008-auditoria/spec.md), [011-integracao-marketplaces](../011-integracao-marketplaces/spec.md#31-armazenamento-seguro-de-credenciais)
(reaproveita o mecanismo de criptografia de credenciais)

## 1. Visão geral

Hoje `AI_API_KEY`, `AI_BASE_URL` e `AI_MODEL` (spec 006, seção 5 — usados por
`plugins/ai/openai-compatible.adapter.ts`) só existem como variáveis de ambiente: trocar de
provedor, de modelo, ou girar uma chave vazada exige editar o `.env`/secret do Container App e
reiniciar o backend. Esta spec move essa configuração para uma tela de administração — editável
em runtime, sem deploy — com a API key **criptografada no banco** e **nunca exibida** depois de
salva, reaproveitando integralmente o mecanismo de envelope encryption já usado pelas
credenciais de marketplace (spec 011, seção 3.1; ADR-021), em vez de criar um segundo esquema de
criptografia.

Pedido do usuário (24/09/2026): "quero que as informações relativas ao modelo de IA... fiquem
configuráveis em uma tela de configuração da aplicação, a API key pode ser reconfigurada mas
nunca ficará visível."

## 2. Modelo de dados

Collection `ai_settings` — **documento único** (`_id: "default"`), mesmo padrão de
`mercado_livre_package_settings` (spec 012, seção 3.4; ADR-027) — não existe conceito de
"múltiplos provedores de IA simultâneos" nesta fase (princípio V da constituição: sem
generalização por antecipação).

```json
{
  "_id": "default",
  "baseUrl": "https://openrouter.ai/api/v1",
  "model": "openai/gpt-4o-mini",
  "apiKey": "k2:base64iv:base64tag:base64dados",
  "apiKeyPreview": "****9f3a",
  "updatedAt": "ISODate",
  "updatedBy": "ObjectId"
}
```

- `apiKey`: **nunca em texto puro** — cifrado com `encryptCredential`/`decryptCredential`
  (`credential-encryption.service.ts`, spec 011 seção 3.1), reaproveitados sem nenhuma mudança:
  a implementação já é genérica (não tem nada específico de "marketplace" no algoritmo, só no
  nome do arquivo/da variável de ambiente da chave-mestra — ver seção 5).
- `apiKeyPreview`: calculada com `maskCredential` no momento em que a chave é salva (mesmo
  padrão de `credentialPreview` em contas de marketplace) — últimos 4 caracteres visíveis,
  nunca derivada de uma decriptação sob demanda.
- `baseUrl`/`model`: texto puro — não são segredo, só apontamento de rota (spec 006, seção 5:
  "Deixe em branco para usar a OpenAI oficial"). `baseUrl` vazio/omitido tem o mesmo
  comportamento de hoje (adapter usa o padrão oficial da OpenAI).
- Sem `_id: "default"` ainda: nenhuma análise/reavaliação por IA funciona — mensagem de erro
  clara apontando para a tela de configuração (mesmo padrão do "pacote padrão" ausente, spec
  012 seção 3.4), nunca uma falha genérica sem contexto.

## 3. Tela de configuração

```
Administração → Configuração de IA (só admin)

┌──────────────────────────────────────────────┐
│ Configuração do provedor de IA                │
│                                                │
│ URL base                                       │
│ [https://openrouter.ai/api/v1              ]  │
│ Em branco = API oficial da OpenAI              │
│                                                │
│ Modelo                                         │
│ [openai/gpt-4o-mini                        ]  │
│                                                │
│ API key                                        │
│ [****9f3a — informe um novo valor pra trocar] │
│ Última atualização: 24/09/2026 às 18:40        │
│                                                │
│         [ Salvar configuração ]                │
└──────────────────────────────────────────────┘
```

- Campo de API key sempre em branco/placeholder ao carregar a tela — **nunca pré-preenchido**
  com o valor real nem com o mascarado (mascarado é só texto de apoio ao lado, não vai pro
  input). Deixar em branco no submit preserva a chave atual; preencher substitui.
- `baseUrl`/`model` chegam pré-preenchidos com o valor atual (não são segredo).
- Sem nenhuma configuração salva ainda: tela mostra os três campos vazios, sem
  `apiKeyPreview`/"última atualização".

## 4. API

```
GET   /api/settings/ai
PATCH /api/settings/ai
```

Ambas exigem `role = admin` (mesmo nível de acesso de contas de marketplace, spec 011 seção
2.2 — configuração de integração externa não é operação de `operator`).

`GET` devolve:

```json
{
  "success": true,
  "data": {
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "openai/gpt-4o-mini",
    "apiKeyPreview": "****9f3a",
    "updatedAt": "2026-09-24T18:40:00.000Z",
    "updatedBy": "ObjectId"
  }
}
```

(`updatedBy` é o `id` do usuário, sem resolução de nome — mesmo formato já devolvido por `GET
/api/marketplace-accounts/mercado-livre-package-settings` hoje; a tela mostra só a data.)

`data` é `null` quando ainda não existe configuração salva (nunca um objeto com campos vazios
fingindo que existe). **`apiKey` (cifrada ou não) nunca aparece em nenhuma resposta** — mesma
garantia estrutural de `MarketplaceAccountRecord` (spec 011): o campo simplesmente não existe
no schema de resposta.

`PATCH` aceita:

```json
{ "baseUrl": "https://openrouter.ai/api/v1", "model": "openai/gpt-4o-mini", "apiKey": "sk-..." }
```

- `apiKey` é **opcional** — omitido, mantém a chave cifrada atual intacta (mesmo padrão de
  `credential` opcional no `PATCH /api/marketplace-accounts/:id`, spec 011). Enviado, cifra o
  novo valor e recalcula `apiKeyPreview`.
- `baseUrl`/`model` também opcionais individualmente — o operador pode trocar só o modelo sem
  reenviar a URL, e vice-versa (merge parcial, não substituição da subseção inteira).
- Primeira configuração (documento ainda não existe): `apiKey` passa a ser **obrigatório**
  nesse caso específico (não dá pra "manter a chave atual" se nunca houve uma) — `baseUrl`/
  `model` continuam sendo os únicos genuinamente opcionais (spec 006: `baseUrl` vazio = OpenAI
  oficial; `model` **sempre obrigatório**, mesma regra que já vale hoje no `.env`, seção 5
  abaixo).

## 5. Regras de negócio

- **Reaproveita a chave-mestra já existente** (`MARKETPLACE_CREDENTIAL_MASTER_KEY`, variável de
  ambiente, ADR-021) — não é criada uma segunda chave-mestra só para IA. O nome da variável
  continua o mesmo (trocar o nome de um secret já em produção é risco desnecessário para um
  ganho cosmético — decisão do usuário, 24/09/2026); ela passa a proteger dois tipos de
  segredo (credenciais de marketplace e chave de IA), através da mesma coleção `credential_keys`
  e do mesmo envelope de duas camadas (seção 6 abaixo detalha a conformidade constitucional).
- **Leitura sem cache.** `getAiSettings()` (nome do serviço, ver plan.md) busca do banco e
  decifra a cada chamada — mesmo trade-off já aceito para credenciais de marketplace (ADR-021,
  seção "consequências": custo de uma leitura pequena por operação, dominado pela latência real
  da chamada de IA em si). Elimina a necessidade de invalidar um cache quando o admin salva uma
  configuração nova — a próxima análise por IA já usa o valor novo, sem reiniciar o backend.
- **`plugins/ai/openai-compatible.adapter.ts` não muda.** Já aceita `apiKey`/`baseURL`/`model`
  explícitos no construtor (`OpenAiCompatibleAdapterConfig`), só caindo para `process.env` como
  *fallback* quando o valor não é passado — `ai-intake.service.ts` (006) passa a sempre
  fornecer os três explicitamente, lidos do banco. `AI_ANALYZE_RATE_LIMIT` **não** faz parte
  desta spec (usuário pediu especificamente `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL`) — continua
  variável de ambiente.
- **Sem configuração salva**: `analyzeProduct`/`reanalyzeProduct` (006) lançam um erro claro
  ("Configure o provedor de IA em Administração → Configuração de IA antes de analisar
  peças.") **antes** de tentar montar o adapter — nunca deixa o erro genérico
  `AI_API_KEY não configurada` (hoje lançado pelo construtor do adapter) vazar pro operador.
- **Auditoria**: toda alteração gera `AI_SETTINGS_UPDATE` (spec 008) com `baseUrl`/`model`
  antigos e novos nos metadados — **nunca** a API key, cifrada ou não (mesma regra de
  `MARKETPLACE_ACCOUNT_UPDATE`). Alterar só `baseUrl`/`model` sem trocar a chave ainda gera o
  registro (é uma alteração de configuração sensível de qualquer forma — troca de destino das
  fotos/descrições enviadas a um provedor externo).
- **RBAC**: `GET`/`PATCH` restritos a `admin` — `operator`/`viewer` recebem `403`, mesma
  fronteira de contas de marketplace (spec 011, seção 2.2) e de pacote padrão do Mercado Livre
  (spec 012, seção 3.4).

## 6. Migração e corte do `.env` (decisão do usuário, 24/09/2026)

**Corte limpo, sem período de convivência com fallback para `.env`**: depois que a configuração
existir no banco de cada ambiente, `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` são removidas do
`.env.example`, do `.env` local de cada desenvolvedor e dos secrets do Container App de
produção. `ai-intake.service.ts` para de ler essas três variáveis — uma única fonte de verdade,
evitando a divergência silenciosa já vista antes entre o schema de produto e o prompt da IA
(spec 006, seção 5, nota sobre `genero`/`busto`).

Passo a passo por ambiente (dev, teste, produção — cada um com sua própria chave de provedor):

1. Deploy desta spec (schema + rotas + tela ainda convivendo com o `.env` antigo até este passo
   — o adapter só para de ler `process.env` depois que `ai-intake.service.ts` for atualizado,
   T-a-definir em tasks.md).
2. Admin abre "Configuração de IA" em cada ambiente e preenche os três campos com os valores
   que hoje estão no `.env` daquele ambiente.
3. Confirma uma análise/reavaliação por IA de teste em cada ambiente.
4. Remove `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` do `.env`/`.env.example`/secret do Container App.

## 7. Impacto no E2E (decisão do usuário, 24/09/2026)

Hoje `e2e/playwright.config.ts` (`backendEnv`) repassa `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` de
`e2e/.env` direto para o processo do backend subido pelo `webServer` (spec 006,
[plan.md](../006-produtos-cadastro-ia/plan.md)). Com a configuração migrada para o banco, isso
deixa de fazer sentido — **`global-setup.ts` passa a semear `ai_settings` no cluster de teste
dedicado**, mesmo padrão idempotente já usado para o admin de fixture (ADR-004) e a categoria
`ETESTE` (`e2e/AGENTS.md`): grava o documento `ai_settings` (`_id: "default"`) direto na
collection, com a API key do provedor de teste já cifrada pela mesma rotina de
`credential-encryption.service.ts` (chamada diretamente pelo script de setup, fora de qualquer
rota HTTP — mesmo espírito de `seed:admin`). `e2e/.env`/`.env.example` mantêm
`AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` (é daí que `global-setup.ts` lê o valor a semear), mas
`playwright.config.ts` para de repassá-las como variável de ambiente do processo do backend.

## 8. Fora de escopo

- Múltiplos provedores de IA configurados simultaneamente (ex.: um por tipo de análise) — só
  existe um provedor ativo por vez, mesma simplicidade do pacote padrão do Mercado Livre.
- `AI_ANALYZE_RATE_LIMIT` — continua variável de ambiente, não foi pedido.
- Histórico/auditoria detalhada de qual modelo processou cada análise passada — já existe
  `ai_metadata.model` por produto (spec 006, seção 6); esta spec não adiciona nada novo aí.
- Validação ativa da API key no momento de salvar (ex.: chamar o provedor pra confirmar que a
  chave funciona antes de aceitar) — salva e só falha na primeira análise real, como o cadastro
  manual de conta de marketplace também não valida o `client_secret` na hora (spec 011).
  Reavaliar se o uso real mostrar necessidade (princípio V).

## 9. Conformidade constitucional

Reaproveita integralmente o mecanismo de envelope encryption do princípio VII/ADR-021: a
chave-mestra (o segredo que, se vazado, compromete tudo) **continua exclusivamente em variável
de ambiente**, nunca no banco — só uma chave de dados *embrulhada* por ela (já cifrada,
inutilizável sem a chave-mestra) fica no banco, e é ela quem cifra a API key de IA. Isso não é
uma exceção ao princípio VII ("segredos exclusivamente em variáveis de ambiente") — é a mesma
leitura já aceita para credenciais de marketplace: o segredo de fato (chave-mestra) nunca sai do
`.env`/secret do Container App; o que vai para o MongoDB é sempre ciphertext. RBAC (`admin`)
aplica o princípio VII (controle de acesso em toda rota sensível); `AI_SETTINGS_UPDATE`
aplica o princípio IX (auditoria de operação sensível). Nenhuma capacidade nova de IA é
introduzida — esta spec só move *onde* a configuração do adapter já existente (006) é lida,
sem alterar nada do princípio I/II (a IA continua só sugerindo, nunca decidindo).
