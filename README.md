# OpenERP Sample

E-commerce + Backoffice administrativo + cadastro de produtos assistido por IA para um brechó.

> **Repositório de demonstração.** Este repositório existe apenas para dar acesso ao código-fonte.
> Não há pipelines de CI/CD, deploy nem infraestrutura de produção configurados.

Este projeto segue a metodologia **spec-driven development**: nenhuma funcionalidade é
implementada sem uma spec correspondente em [`specs/`](specs/), e todas as specs devem estar
em conformidade com os princípios definidos em
[`memory/constitution.md`](memory/constitution.md).

## Estrutura

```
OpenERPSampleProject/
├── AGENTS.md                    # instruções para agentes de IA (qualquer modelo/ferramenta)
├── memory/
│   └── constitution.md          # princípios inegociáveis do projeto
├── specs/                       # uma pasta por domínio funcional
│   ├── 001-autenticacao/
│   ├── 002-usuarios/
│   ├── 003-categorias/
│   ├── 004-sku/
│   ├── 005-produtos-cadastro-manual/
│   ├── 006-produtos-cadastro-ia/
│   ├── 007-imagens/
│   ├── 008-auditoria/
│   └── 009-dashboard/
├── backend/                     # API Fastify + TypeScript + MongoDB
│   ├── AGENTS.md                 # convenções específicas do backend
│   └── src/
├── frontend/                    # React + Vite 8 + TypeScript
│   ├── AGENTS.md                 # convenções específicas do frontend
│   └── src/
├── e2e/                         # Testes E2E (Playwright Test) — front + back juntos
│   ├── AGENTS.md                 # convenções específicas de E2E
│   └── tests/
├── shared/                      # schemas/types Zod compartilhados entre front e back
└── Especificação Funcional e Técnica — ERP SAMPLE para Brechó.md   # documento fonte original
```

## Ordem de leitura recomendada

1. [`AGENTS.md`](AGENTS.md) — se você é um agente de IA (ou está configurando um), comece
   aqui.
2. [`memory/constitution.md`](memory/constitution.md) — princípios e restrições do projeto.
3. `specs/001-autenticacao` → `009-dashboard` — specs do MVP (fase 1 e 2 do roadmap), na
   ordem de dependência indicada em cada spec.
4. Documento fonte (`Especificação Funcional e Técnica...md`) — referência histórica completa;
   em caso de conflito, a constituição e as specs prevalecem.

## Como rodar (após `npm install` em cada pacote)

```bash
# Backend
cd backend
cp .env.example .env   # preencher MONGODB_URI, JWT secrets, AI_API_KEY, Azure Storage
npm install
npm run dev             # http://localhost:3333

# Frontend
cd frontend
npm install
npm run dev              # http://localhost:5173

# E2E (Playwright) — sobe backend+frontend sozinho, roda contra o cluster de teste do Atlas
cd e2e
cp .env.example .env    # preencher MONGODB_URI (cluster de TESTE), JWT secrets, E2E_ADMIN_*
npm install
npx playwright install chromium
npm test
```

## Escopo do MVP

Login, Dashboard, Usuários, Categorias, Produtos (cadastro manual e por IA), SKU automático,
upload de imagens, edição de produto, busca, controle de status e auditoria básica. Detalhes
completos em [`memory/constitution.md`](memory/constitution.md#4-escopo-do-mvp).
