# AGENTS.md — e2e

Instruções específicas para agentes de IA trabalhando em `e2e/`. Complementa o
[`AGENTS.md`](../AGENTS.md) da raiz — leia-o primeiro.

## Stack

Playwright Test, orquestrando `backend/` e `frontend/` juntos via `webServer` (não é uma
suíte isolada — sobe os dois processos reais e testa contra eles).

## Banco de dados usado

**Sempre o cluster de teste dedicado do Atlas** (`mongodbEnvironments/test_atlas-credentials.env`,
`USER_MONGODB_URI`), nunca o de dev nem o de produção. Isso é intencional: diferente dos
testes de integração do backend (`mongodb-memory-server`, isolados e rápidos), o propósito do
E2E é validar contra infraestrutura o mais próxima possível do real.

## Comandos

```bash
npm test              # roda toda a suíte (playwright test)
npm run test:ui        # UI mode do Playwright (interativo)
npm run test:headed     # com browser visível
```

Antes da primeira vez: `npm install && npx playwright install chromium`.

## Configuração (`e2e/.env`, nunca versionado)

- `MONGODB_URI`: sempre `mongodb+srv://` do cluster de teste — nunca a forma expandida sem
  SRV (isso só é necessário em sandboxes de ferramentas com DNS restrito; não usar em máquina
  normal nem commitar assim). Se `npx playwright test` travar com
  `Timed out waiting 30000ms from config.webServer` num sandbox assim: (1) obtenha a forma
  expandida do cluster de TESTE via `nslookup -type=SRV _mongodb._tcp.<cluster>.mongodb.net` +
  `nslookup -type=TXT <cluster>.mongodb.net` (mesma técnica do `backend/.env.example`); (2)
  **não edite `e2e/.env`** — suba `backend`/`frontend` manualmente nas portas 3333/5173 com a
  URI expandida só no ambiente do processo, e deixe o `webServer` do Playwright reaproveitá-los
  via `reuseExistingServer` (`npx playwright test` normalmente depois).
- `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`: próprios do ambiente de E2E, não reaproveitar os
  de dev/prod.
- `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`: credenciais fixas do admin de fixture — o
  `global-setup.ts` garante (idempotente) que essa conta existe antes de qualquer spec rodar.
- `AZURE_STORAGE_CONNECTION_STRING`/`AZURE_STORAGE_CONTAINER_NAME` (`product-images-test`):
  mesma Storage Account de dev/prod (ADR-003), container próprio do ambiente de teste — usado
  pelos specs de produto (005) que fazem upload de foto de verdade.
- `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL`: mesmo provedor de IA de dev — os specs de 006
  (`product-ai.spec.ts`) chamam `POST /products/analyze` de verdade, sem mock de adapter
  (mesma filosofia de infra real). Custo/latência reais por execução da suíte, aceitos
  deliberadamente. Esses dois specs rodam em `test.describe.serial` (nunca simultâneos entre
  si) porque o provedor self-hosted do ambiente de teste não responde de forma confiável a
  duas chamadas de análise concorrentes — se algum dia trocar de provedor e isso deixar de ser
  necessário, pode voltar a `test.describe` normal.

## Convenções dos testes

- **Cada spec deve ser autossuficiente** — specs rodam em paralelo por padrão (`fullyParallel`),
  então nunca dependa de outro arquivo ter rodado antes. Precisa de um operador para testar
  RBAC? Crie um dentro do próprio teste (e-mail com timestamp, nunca fixo) em vez de reaproveitar
  um de outro spec.
- **E-mails de fixture sempre únicos** (`` `e2e.<contexto>.${Date.now()}@example.com` ``)
  — o índice único em `users.email` rejeitaria reruns com valor fixo, e dados de execuções
  anteriores não são limpos automaticamente (aceitável nesse banco de teste).
- **Categoria de fixture é a exceção** — diferente de usuário/produto, o código de categoria só
  aceita letras (regex de 003), então não dá para gerar um valor único por execução com
  timestamp. `global-setup.ts` seeda (idempotente, mesmo padrão do admin) a categoria
  `ETESTE`/"Categoria E2E" — specs de produto (005) usam essa mesma categoria fixa; nunca crie
  uma nova categoria por teste.
- **Teste "front e back" quando a spec pedir isso explicitamente** (ex.: RBAC) — não basta
  checar que a UI esconde/redireciona; chame a API direto via `page.request` (reaproveita os
  cookies da sessão do browser) para confirmar que o backend também recusa.
- **`reuseExistingServer: !process.env.CI`** no `playwright.config.ts`: em dev local, se você
  já tiver `npm run dev` rodando manualmente no backend apontando para o banco de DEV, os
  testes vão reaproveitar esse processo e rodar contra dev, não contra teste. Se os testes
  E2E começarem a se comportar de forma estranha, confira se não há um backend de dev já
  escutando na porta 3333.
