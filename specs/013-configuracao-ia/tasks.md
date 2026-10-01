# Tasks 013 — Configuração do Provedor de IA

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Depende de:** [006-produtos-cadastro-ia/tasks.md](../006-produtos-cadastro-ia/tasks.md),
[008-auditoria/tasks.md](../008-auditoria/tasks.md), [011-integracao-marketplaces/tasks.md](../011-integracao-marketplaces/tasks.md)
(`credential-key.service.ts`/`credential-encryption.service.ts`)
**Convenção:** `[P]` = tarefa paralelizável.

## Fase 1 — Schema compartilhado

- [x] T001 `shared/schemas/ai-settings.schema.ts`: `AiSettingsInputSchema` (`baseUrl`, `model`,
      `apiKey` todos opcionais — obrigatoriedade na primeira configuração é regra de service,
      não de schema, ver plan.md seção 5) e `AiSettingsRecordSchema` (saída: `baseUrl`, `model`,
      `apiKeyPreview`, `updatedAt`, `updatedBy` — **sem** `apiKey`). Teste unitário: schema de
      saída rejeita um objeto que contenha `apiKey` (`.strict()` — defesa estrutural contra o
      campo vazar por engano, mesmo espírito da seção 8.2-C de 006). 6 casos, `ai-settings.schema.test.ts`.

## Fase 2 — Backend core

- [x] T002 `backend/src/repositories/ai-settings.repository.ts`: `find(db)`/`upsert(db, values,
      updatedBy)`, documento único `_id: "default"` na collection `ai_settings` — mesma
      estrutura de `mercado-livre-package-settings.repository.ts` — depende de T001.
- [x] T003 `backend/src/services/ai-settings.service.ts`:
      - `getAiSettings()`: decifra `apiKey` via `credential-encryption.service.ts`
        (`decryptCredential`) — uso interno, nunca exposto por rota.
      - `getAiSettingsForDisplay()`: mesma leitura, devolve `apiKeyPreview` em vez de `apiKey`.
      - `updateAiSettings(input, actingUserId)`: `apiKey` presente → `encryptCredential` +
        `maskCredential` (recalcula `apiKeyPreview`); ausente → mantém os campos gravados
        (merge parcial). Sem documento anterior e sem `apiKey`/`model` no input → rejeita
        (`AiSettingsIncompleteError`) antes de gravar. Sempre grava auditoria
        (`AI_SETTINGS_UPDATE`, metadados `baseUrl`/`model` antigo/novo — spec 008 padrão
        `PRICE_UPDATE` — mais só um booleano `apiKeyChanged`, nunca a chave) — depende de T002,
        [008-auditoria](../008-auditoria/tasks.md).
      Teste unitário (`ai-settings.service.test.ts`, 10 casos): roundtrip cifra/decifra; `apiKey`
      omitido preserva o valor cifrado atual; primeira configuração sem `apiKey`/`model` rejeita
      sem gravar nada; auditoria nunca recebe a chave nos metadados.
      **Achado real testando** (ver Nota ao final desta fase): primeira configuração sem
      `baseUrl` gravava `undefined` em vez de `""`, e o driver do Mongo (`ignoreUndefined`)
      omitia o campo do documento inteiro — a resposta seguinte quebrava o parse do schema
      (`baseUrl` não opcional). Corrigido: `baseUrl: input.baseUrl ?? (before ? undefined : "")`.
- [x] T004 `backend/src/routes/ai-settings.routes.ts`: `GET`/`PATCH /api/settings/ai`, ambas
      `authorize(["admin"])`. `GET` sem configuração → `{success:true, data:null}`. `PATCH`
      valida `AiSettingsInputSchema`, mapeia `AiSettingsIncompleteError` → 400 com mensagem
      clara — depende de T003.
- [x] T005 `backend/src/modules/ai-settings.module.ts`, prefixo `/api/settings`, registrado em
      `app.ts` — depende de T004.
- [x] T006 Teste de integração `backend/tests/integration/ai-settings.spec.ts` (8 casos): sem
      sessão → 401; `operator`/`viewer` → 403 nas duas rotas; `GET` sem configuração →
      `data:null`; `PATCH` primeira vez sem `apiKey`/sem `model` → 400; `PATCH` completo → 200,
      `apiKeyPreview` calculado, resposta sem `apiKey` (cifrada ou não) em nenhum campo; `PATCH`
      só com `model` → `apiKeyPreview` inalterado; `audit_logs` confirma `AI_SETTINGS_UPDATE`
      sem a chave nos metadados; regressão do achado real acima (primeira config sem `baseUrl`)
      — depende de T005.

## Fase 3 — Integração com o cadastro por IA (spec 006)

- [x] T007 `backend/src/services/ai-intake.service.ts`: `getProvider()` vira `async`, busca
      `ai-settings.service.getAiSettings()` a cada chamada (sem cache — ADR-021), constrói
      `new OpenAiCompatibleAdapter({apiKey, baseURL: baseUrl || undefined, model,
      systemPrompt: DEFAULT_SYSTEM_PROMPT})`; sem configuração, lança
      `AiSettingsNotConfiguredError` **antes** de tentar montar o adapter (mensagem aponta pra
      tela `Administração → Configuração de IA`) — mapeada pra 400 em `ai-intake.routes.ts`
      (`/analyze` e `/reanalyze`). `openai-compatible.adapter.ts` também mudou: parou de ler
      `process.env.AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` como fallback (só `ai-intake.service.ts`
      chama este adapter, e agora sempre passa config explícita) — depende de T003.
- [x] T008 `setAiProviderForTesting` aceita `undefined` pra limpar a injeção (seam de teste
      volta a consultar `ai_settings` de verdade). Novos casos em
      `tests/integration/ai-intake.spec.ts`: `/analyze` e `/reanalyze` sem `ai_settings`
      configurado → 400 com "Configuração de IA" na mensagem — depende de T007. (Os testes
      unitários existentes de `ai-intake.service.test.ts` não precisaram de mudança: já usavam
      `setAiProviderForTesting` antes de qualquer chamada, seam que continua funcionando igual.)

## Fase 4 — Auditoria (spec 008)

- [x] T009 `AI_SETTINGS_UPDATE` no enum de `backend/src/schemas/audit-log.schema.ts` **e**
      `frontend/src/schemas/audit-log.schema.ts` (cópia própria, spec 008 seção 3) + rótulo em
      `AuditLogsPage.tsx` ("Configuração do provedor de IA atualizada") — teste de contrato
      existente (008) confirma que os dois lados batem — depende de T003.

## Fase 5 — Frontend

- [x] T010 [P] `frontend/src/schemas/ai-settings.schema.ts` (form schema RHF — `apiKey` sempre
      opcional no schema, nunca populado com valor real), `frontend/src/services/ai-settings.service.ts`
      (GET/PATCH), `frontend/src/hooks/useAiSettings.ts` (query + mutation TanStack Query).
- [x] T011 `frontend/src/pages/admin/AiSettingsPage.tsx` — campo de API key **sempre vazio ao
      carregar** (`type="password"`, placeholder mostra `apiKeyPreview` só como texto de apoio,
      nunca como `value`); `baseUrl`/`model` pré-preenchidos via `useForm({values: ...})`
      (re-sincroniza quando a query resolve, mesmo padrão de `PackageSettingsCard`). Estados
      `loading/success/error/empty` (sem configuração ainda) — depende de T010.
- [x] T012 Rota `/admin/ai-settings` em `App.tsx` (`ProtectedRoute roles={["admin"]}`) + link
      "Configuração de IA" em `AppLayout.tsx` (bloco admin, ao lado de "Usuários") — depende de
      T011.

**Validado de ponta a ponta no navegador** (Playwright avulso, admin real, backend/frontend/Mongo
de dev reais): campo de API key confirmado vazio ao carregar; `PATCH` salva e a resposta nunca
contém a chave (nem cifrada, nem em texto puro); `baseUrl`/`model` persistem e reaparecem
corretamente após F5, campo de API key continua vazio; **uma chamada real a `POST
/api/products/analyze` retornou 200 usando a configuração lida do banco** (backend já sem
nenhuma leitura de `process.env.AI_*`) — confirma a migração funcionando de ponta a ponta contra
o provedor de IA real de dev, não só contra mocks.

## Nota (24/09/2026) — bug real encontrado e corrigido nesta fase

Testando a primeira configuração salva sem preencher "URL base" (deixado em branco de propósito
— spec, seção 2: "vazio = OpenAI oficial"), `updateAiSettings` passava `baseUrl: undefined` pro
repositório. O driver do MongoDB (`ignoreUndefined: true`, `mongo.client.ts`) omite chaves
`undefined` do `$set`, então o documento era criado **sem o campo `baseUrl` nenhum** — o valor
sumia do JSON de resposta (`JSON.stringify` também descarta `undefined`), e
`AiSettingsRecordSchema.parse()` no frontend rejeitava por `baseUrl` ser obrigatório e ausente.
Corrigido fazendo `updateAiSettings` gravar `""` explicitamente na primeira configuração quando
`baseUrl` não vem no input (edições continuam usando `undefined` = "não mexer", comportamento
correto). Teste de regressão em `ai-settings.service.test.ts` e `ai-settings.spec.ts`.

## Fase 6 — Corte do `.env` (spec, seção 6 — só depois de T007 implantado)

- [x] **Dev**: configuração salva no banco de dev via a tela (validado na Fase 5 acima) —
      `.env` local **ainda não limpo** (deixado de propósito até produção/teste também migrarem,
      pra não perder o valor de referência caso precise comparar).
- [ ] **Teste e produção**: ainda não migrados — depende de deploy desta spec + acesso de admin
      em cada ambiente pra preencher a tela. Só depois disso remover
      `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` de `backend/.env.example`, do `.env` de cada
      ambiente e do secret do Container App de produção.

## Fase 6 — Corte do `.env` (spec, seção 6 — só depois de T007 implantado)

- [ ] T013 Por ambiente (dev, teste, produção), nesta ordem: (a) admin preenche "Configuração
      de IA" com os valores hoje em `.env`/secret; (b) confirma uma análise/reavaliação por IA
      real; (c) remove `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` de `backend/.env.example`, do
      `.env` local e do secret do Container App de produção — depende de T007 já estar em
      produção havia pelo menos uma configuração salva com sucesso.

## Fase 7 — E2E

- [x] T014 `e2e/global-setup.ts`: novo passo idempotente que grava `ai_settings` (`_id:
      "default"`) direto na collection do cluster de teste, cifrando a API key de teste com
      `credential-encryption.service.ts` chamada diretamente (bypassa `ai-settings.service.ts`
      de propósito — mesmo espírito da seed de admin/categoria `ETESTE`, evita
      `AI_SETTINGS_UPDATE` em `audit_logs` a cada execução da suíte) — depende de T002.
      **Risco do plan.md (seção 7) confirmado na prática**: `MARKETPLACE_CREDENTIAL_MASTER_KEY`
      não existia em `e2e/.env.example` nem em `backendEnv` (nenhum spec de e2e tinha tocado
      `credential-key.service.ts` até agora — marketplace não tem spec de e2e ainda). Adicionada
      a variável nos dois lugares; chave real gerada e adicionada ao `e2e/.env` local.
- [x] T015 `e2e/playwright.config.ts` (`backendEnv`): remove o repasse de
      `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` pro processo do backend — a configuração agora vem
      do banco (T014), semeada pelo `global-setup.ts`. Ganhou `MARKETPLACE_CREDENTIAL_MASTER_KEY`
      (necessária pro backend decifrar a chave gravada por T014). `e2e/.env`/`.env.example`
      mantêm as três variáveis de IA (é daí que `global-setup.ts` lê o valor a semear) — depende
      de T014.

**Validado rodando a suíte inteira contra o cluster de teste dedicado** (7 specs, 9 testes,
`reuseExistingServer` com backend/frontend subidos manualmente — mesmo workaround de DNS SRV já
documentado em `e2e/AGENTS.md` pra este ambiente de ferramentas sandboxed): todos os specs de
produto (`product-edit`, `product-manual-registration`, `product-mark-as-sold`) e os dois specs
reais de cadastro por IA (`product-ai.spec.ts` — chamam `/analyze` de verdade) passaram, além de
`dashboard`/`user-management`/`user-access-control` sem regressão. Confirma que
`ai-intake.service.ts` funciona contra o provedor de IA real usando só a configuração semeada no
banco pelo `global-setup.ts`, sem nenhuma leitura de `process.env.AI_*` no processo do backend.

## Dependências entre tarefas

```
T001 → T002 → T003 → T004 → T005 → T006
T003 → T007 → T008
T003 → T009
T002,T003 → T010 → T011 → T012
T007 → T013
T002 → T014 → T015
```
