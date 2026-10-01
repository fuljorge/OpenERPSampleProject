# Plan 013 — Configuração do Provedor de IA

**Spec:** [spec.md](spec.md)
**Constituição:** [memory/constitution.md](../../memory/constitution.md)
**Depende de:** [006-produtos-cadastro-ia/plan.md](../006-produtos-cadastro-ia/plan.md),
[008-auditoria/plan.md](../008-auditoria/plan.md), [011-integracao-marketplaces/plan.md](../011-integracao-marketplaces/plan.md)
(reaproveita `credential-encryption.service.ts`/`credential-key.service.ts`)

## 1. Stack técnica

Nenhuma dependência nova. Reaproveita integralmente:

| Peça | Já existe em |
|---|---|
| Envelope encryption (chave-mestra + chaves de dados versionadas) | `backend/src/services/credential-key.service.ts` |
| Cifrar/decifrar/mascarar valor | `backend/src/services/credential-encryption.service.ts` |
| Padrão "documento único de configuração" (`_id: "default"`, `findOneAndUpdate upsert`) | `backend/src/repositories/mercado-livre-package-settings.repository.ts` |
| Adapter de IA já aceita config explícita (não só `process.env`) | `backend/src/plugins/ai/openai-compatible.adapter.ts` |

## 2. Contexto técnico

`ai-intake.service.ts` (006) hoje instancia `OpenAiCompatibleAdapter` como singleton lazy,
lido de `process.env.AI_*`. Esta spec substitui a origem do valor (banco em vez de env) sem
tocar no adapter — `OpenAiCompatibleAdapterConfig` já aceita `apiKey`/`baseURL`/`model`
explícitos, o construtor só cai para `process.env` quando o campo não é passado.

## 3. Estrutura de arquivos

```
shared/schemas/
└── ai-settings.schema.ts             # AiSettingsSchema (entrada), AiSettingsRecordSchema (saída, sem apiKey)

backend/src/
├── repositories/ai-settings.repository.ts   # find/upsert, doc único "default" — mesmo padrão de mercado-livre-package-settings.repository.ts
├── services/ai-settings.service.ts          # getAiSettings (decifrada, USO INTERNO só) / getAiSettingsForDisplay (sem apiKey) / updateAiSettings
├── schemas/ai-settings.schema.ts            # reexporta de shared/dist
├── routes/ai-settings.routes.ts             # GET/PATCH /api/settings/ai (adminGuard)
├── modules/ai-settings.module.ts            # registra o prefixo /api/settings
└── services/ai-intake.service.ts            # MUDA: getProvider() vira async, lê getAiSettings() em vez de process.env

frontend/src/
├── schemas/ai-settings.schema.ts     # form schema (RHF), tipos
├── services/ai-settings.service.ts   # GET/PATCH /api/settings/ai
├── hooks/useAiSettings.ts            # query + mutation (TanStack Query)
├── pages/admin/AiSettingsPage.tsx    # tela — mesmo estilo de MarketplaceAccountsPage.tsx
├── components/AppLayout.tsx          # MUDA: novo link "Configuração de IA" (bloco admin)
└── app/App.tsx (ou equivalente de rotas)  # MUDA: rota /admin/ai-settings
```

## 4. Fluxo de execução (camadas)

```
AiSettingsPage (RHF)
  → ai-settings.service.ts (GET/PATCH /api/settings/ai)
  → routes/ai-settings.routes.ts (Fastify, authenticate + authorize(["admin"]))
  → schemas/ai-settings.schema.ts (Zod: baseUrl/model opcionais, apiKey opcional no PATCH
    exceto na primeira configuração)
  → services/ai-settings.service.ts
      → credential-encryption.service.ts (encryptCredential/maskCredential — só quando apiKey veio no body)
      → repositories/ai-settings.repository.ts (upsert, doc único)
      → audit-log.service.record("AI_SETTINGS_UPDATE", ...) — nunca inclui apiKey
  → resposta { success: true, data: AiSettingsRecord } (sem apiKey, cifrada ou não)

Em paralelo, tempo de análise por IA:
ai-intake.service.ts (analyzeProduct/reanalyzeProduct)
  → getProvider() [async]
      → ai-settings.service.getAiSettings() — decifra apiKey via credential-encryption.service.ts
      → sem configuração: lança AiSettingsNotConfiguredError (mensagem aponta pra tela)
      → new OpenAiCompatibleAdapter({ apiKey, baseURL: baseUrl || undefined, model, systemPrompt: DEFAULT_SYSTEM_PROMPT })
  → (resto do fluxo de 006 inalterado)
```

## 5. Passos de implementação

1. `shared/schemas/ai-settings.schema.ts`: `AiSettingsInputSchema` (`baseUrl: z.string().optional()`,
   `model: z.string().min(1).optional()`, `apiKey: z.string().min(1).optional()`) e
   `AiSettingsRecordSchema` (saída: `baseUrl`, `model`, `apiKeyPreview`, `updatedAt`,
   `updatedBy` — **sem** `apiKey`, cifrada ou não, em nenhum dos dois). A obrigatoriedade de
   `apiKey`/`model` na **primeira** configuração é validada no service (T-a-definir em
   tasks.md), não no schema Zod de entrada — depende de existir ou não um documento anterior,
   regra dinâmica demais para o schema estático.
2. `repositories/ai-settings.repository.ts`: `find(db)`/`upsert(db, values, updatedBy)` no
   documento `_id: "default"` da collection `ai_settings` — cópia estrutural de
   `mercado-livre-package-settings.repository.ts` (T-a-definir).
3. `services/ai-settings.service.ts`:
   - `getAiSettings(): Promise<{ baseUrl, model, apiKey } | null>` — decifra a API key
     (`decryptCredential`), **uso interno only** (nunca exposto por rota).
   - `getAiSettingsForDisplay(): Promise<AiSettingsRecord | null>` — mesma leitura, mas devolve
     `apiKeyPreview` no lugar de `apiKey`; é o que a rota `GET` expõe.
   - `updateAiSettings(input, actingUserId)`: se `input.apiKey` vier, cifra
     (`encryptCredential`) e recalcula `apiKeyPreview` (`maskCredential`); senão, mantém o
     `apiKey`/`apiKeyPreview` gravados (merge parcial via `repository.upsert`, que só sobrescreve
     os campos informados — mesmo cuidado de "PATCH parcial não apaga campos irmãos" já
     documentado em 005). Sem documento anterior **e** sem `apiKey`/`model` no `input`: rejeita
     antes de gravar (`AiSettingsIncompleteError` — primeira configuração exige os dois).
     Sempre grava auditoria (`AI_SETTINGS_UPDATE`, metadados só `baseUrl`/`model`
     antigo/novo — nunca a chave).
4. `routes/ai-settings.routes.ts`: `GET`/`PATCH /api/settings/ai`, ambas com
   `authorize(["admin"])`. `GET` devolve `{success:true, data: null}` sem configuração salva.
5. `services/ai-intake.service.ts`: `getProvider()` vira `async`; busca
   `ai-settings.service.getAiSettings()` a cada chamada (sem cache — ADR-021, mesma
   justificativa), lança `AiSettingsNotConfiguredError` se `null`. `analyzeProduct`/
   `reanalyzeProduct` propagam o `await` (mudança de assinatura interna, sem impacto na API
   pública de `/analyze`/`/reanalyze`, que já são `async`). Remove a leitura de
   `process.env.AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL`.
6. `schemas/audit-log.schema.ts` (backend **e** frontend, spec 008 seção 3): novo valor
   `AI_SETTINGS_UPDATE` no enum — teste de contrato existente (008) já falha se os dois lados
   divergirem, não precisa de teste novo.
7. Frontend: `ai-settings.schema.ts`, `ai-settings.service.ts`, `useAiSettings.ts` (mesmo
   trio de `mercado-livre-package-settings` do lado de marketplace), `AiSettingsPage.tsx`
   (campo de API key **sempre vazio ao carregar**, nunca populado com `apiKeyPreview` —
   mostrado como texto de apoio ao lado do campo, não como valor do input). Rota
   `/admin/ai-settings` + link em `AppLayout.tsx` (bloco `user?.role === "admin"`, ao lado de
   "Marketplaces").
8. `.env.example`/`.env` (backend): remove `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` **só depois**
   que o passo 5 estiver implantado e a configuração de cada ambiente estiver migrada (spec,
   seção 6) — ordem importa, não é um passo atômico com o resto.
9. `e2e/global-setup.ts`: novo passo idempotente que grava `ai_settings` (`_id: "default"`)
   direto na collection do cluster de teste, cifrando a API key de teste com
   `credential-encryption.service.ts` chamada diretamente (fora de rota HTTP, mesmo espírito de
   `seed:admin`/da seed de categoria `ETESTE`) — depende de `MARKETPLACE_CREDENTIAL_MASTER_KEY`
   já estar disponível no processo do `global-setup.ts` (hoje só o backend a lê; script de setup
   precisa importar `credential-key.service.ts`/`credential-encryption.service.ts` diretamente,
   não via HTTP). `e2e/playwright.config.ts` (`backendEnv`) para de repassar
   `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` pro processo do backend.

## 6. Testes planejados

- Unitário: `ai-settings.service` — `updateAiSettings` sem `apiKey` preserva o valor cifrado
  atual (não re-cifra, não perde o dado); primeira configuração sem `apiKey`/`model` rejeita
  antes de gravar; `getAiSettings` decifra corretamente (roundtrip com
  `credential-encryption.service.ts`, mesmo padrão de `marketplace-account.service.test.ts`).
  `ai-intake.service.getProvider` (mockando `ai-settings.service`): sem configuração lança
  `AiSettingsNotConfiguredError` sem tentar chamar o provedor; com configuração, constrói o
  adapter com os três valores decifrados/lidos do banco (spy no construtor ou no `analyze`
  resultante).
- Integração: `GET /api/settings/ai` sem sessão → 401; `operator`/`viewer` → 403; sem
  configuração → `200` com `data: null`; `PATCH` primeira vez sem `apiKey` → 400; `PATCH` com
  os três campos → 200, `apiKeyPreview` calculado, resposta **nunca** contém `apiKey`; `PATCH`
  só com `model` (sem `apiKey`) → `apiKeyPreview` continua o mesmo de antes (prova de que a
  chave antiga não foi apagada); `audit_logs` confirma `AI_SETTINGS_UPDATE` sem a chave nos
  metadados. `POST /api/products/analyze` sem `ai_settings` configurado → 400 claro (não o erro
  genérico de adapter).
- E2E: fora de escopo um spec novo dedicado — a configuração semeada por `global-setup.ts`
  (seção 5, passo 9) já é exercida indiretamente por todo spec que já chama `/analyze`/
  `/reanalyze` (`product-ai.spec.ts`, cadastro por IA) — se a seed estiver errada, esses specs
  já existentes falham e apontam o problema.

## 7. Riscos / decisões em aberto

- **Nome da variável de ambiente da chave-mestra continua `MARKETPLACE_CREDENTIAL_MASTER_KEY`**
  mesmo protegendo um segredo que não é mais só de marketplace — decisão consciente do usuário
  (spec, seção 5) para não arriscar um rename de secret já em produção. Se isso incomodar depois,
  um rename puro (sem mudar o valor) é reversível a qualquer momento, sem re-cifrar nada.
- Ordem de corte do `.env` (spec, seção 6) depende de disciplina operacional — nada no código
  impede alguém de remover as variáveis antes de configurar a tela em algum ambiente,
  resultando em erro claro (`AiSettingsNotConfiguredError`) mas evitável com checklist.
- `global-setup.ts` (passo 9) precisa rodar `credential-key.service.ts`/
  `credential-encryption.service.ts` fora do processo do backend, direto contra o Mongo do
  cluster de teste — confirmar em implementação que `MARKETPLACE_CREDENTIAL_MASTER_KEY` do
  ambiente de teste já está acessível no processo do Playwright (hoje só é lida pelo backend
  via `backendEnv`); se não estiver, `e2e/.env`/`playwright.config.ts` precisam expor essa
  variável também para o processo do `global-setup.ts`.
