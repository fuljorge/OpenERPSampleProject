# AGENTS.md — OpenERP Sample

Este arquivo é a fonte de instruções para **qualquer agente de IA** (Claude Code, Codex,
Cursor, Gemini CLI, Copilot, ou outro) que trabalhe neste repositório, independente do modelo
por trás. Ele é complementado por arquivos `AGENTS.md` mais específicos em subpastas —
[`backend/AGENTS.md`](backend/AGENTS.md), [`frontend/AGENTS.md`](frontend/AGENTS.md),
[`e2e/AGENTS.md`](e2e/AGENTS.md) e [`shared/AGENTS.md`](shared/AGENTS.md). Regra de
precedência: o `AGENTS.md` mais próximo do arquivo que está sendo editado vence em caso de
conflito; este arquivo raiz vale para tudo que não estiver coberto por um mais específico.

## 0. Leia isto antes de qualquer tarefa

1. Leia [`memory/constitution.md`](memory/constitution.md) — princípios inegociáveis do
   projeto. Não implemente nada que os contrarie.
2. Localize a spec correspondente à tarefa em `specs/NNN-feature/`. Cada feature tem três
   artefatos, nesta ordem de dependência: `spec.md` (o quê e por quê) → `plan.md` (como,
   tecnicamente) → `tasks.md` (passos concretos, testáveis).
3. **Nunca implemente uma funcionalidade sem spec correspondente.** Se não existir spec para o
   que foi pedido, avise o usuário e proponha criá-la antes de codificar.
4. Use o vocabulário de [`memory/glossary.md`](memory/glossary.md) — não inventar sinônimos
   para termos de domínio (ex.: sempre "peça única", nunca "item"; sempre `sku`, nunca
   "código do produto").
5. Verifique [`memory/decisions.md`](memory/decisions.md) para decisões arquiteturais (ADRs)
   já tomadas antes de propor uma alternativa que talvez já tenha sido descartada.

## 1. Visão geral do projeto

E-commerce + backoffice administrativo + cadastro de produtos assistido por IA para um brechó.
Metodologia: **spec-driven development** — ver seção 0.

```
ERP/
├── AGENTS.md                    # este arquivo — instruções gerais para agentes de IA
├── memory/
│   ├── constitution.md          # princípios inegociáveis (fonte de verdade)
│   ├── glossary.md              # vocabulário de domínio
│   ├── decisions.md             # ADRs — decisões técnicas com trade-offs
│   └── constitution_update_checklist.md
├── specs/                       # uma pasta por domínio funcional (spec → plan → tasks)
│   ├── 001-autenticacao/
│   ├── 002-usuarios/
│   ├── 003-categorias/
│   ├── 004-sku/
│   ├── 005-produtos-cadastro-manual/
│   ├── 006-produtos-cadastro-ia/
│   ├── 007-imagens/
│   ├── 008-auditoria/
│   └── 009-dashboard/
├── backend/                     # API Fastify + TypeScript + MongoDB — ver backend/AGENTS.md
├── frontend/                    # React + Vite + TypeScript — ver frontend/AGENTS.md
├── e2e/                         # Playwright Test (front+back juntos) — ver e2e/AGENTS.md
└── shared/                      # schemas Zod compartilhados (pacote próprio, compilado —
                                  # ver shared/AGENTS.md antes de importar de lá)
```

## 2. Stack fixada nesta fase

| Camada | Tecnologia |
|---|---|
| Frontend | React + Vite 8 + TypeScript + React Router + TanStack Query + React Hook Form + Zod |
| Backend | Node.js + TypeScript + Fastify + Zod + MongoDB Driver oficial |
| Banco de dados | MongoDB Atlas |
| Imagens | Azure Blob Storage |
| IA de cadastro | Modelo multimodal, acessado exclusivamente pelo backend |

Não introduzir microserviços, Kafka, Redis, Kubernetes, LangChain/LangGraph ou filas
distribuídas nesta fase (constituição, princípio V). Mudança de stack exige atualizar
`memory/constitution.md` com justificativa.

## 3. Arquitetura obrigatória

```
React → API Fastify → Application Service → Domain Rules → Repository → MongoDB
```

Integrações externas (IA, imagens) são sempre acessadas por camadas de abstração
(`*ProviderPort` / adapter), nunca diretamente pelas regras de negócio (constituição,
princípio VI). A IA de cadastro **sugere**; nunca decide, nunca grava direto no MongoDB, nunca
gera SKU. Ver princípio I da constituição para a lista completa do que a IA nunca deve fazer.

## 4. Regras não negociáveis (resumo — ver constituição para o texto completo)

- Human in the loop obrigatório: nada gerado por IA é persistido sem revisão humana.
- SKU nunca é "buscar último + somar 1" — sempre `findOneAndUpdate` atômico com `$inc`.
- Zod valida toda entrada em toda camada; nenhum dado é confiável sem validação.
- Senhas com Argon2id; RBAC (`admin`/`operator`/`viewer`) em toda rota sensível; rate limiting
  em `/auth/login` e `/products/analyze`; segredos só em `.env` (nunca versionado).
- Exclusão lógica (`status = inactive`/`inativo`), nunca `DELETE` físico por padrão.
- Toda operação sensível gera registro em `audit_logs`.
- Fora do escopo do MVP: carrinho, checkout, pagamento, frete, integrações com
  marketplaces, CRM, precificação automática, multiagentes. Não implementar por antecipação.

## 5. Convenções de código

- TypeScript em modo `strict` nos dois pacotes; ESLint + Prettier.
- `shared/` contém os schemas Zod e tipos usados por front e back — importar de lá em vez de
  duplicar definições.
- Sem abstrações prematuras: resolva o que a task pede, não o que pode ser útil no futuro.
- Comentários só quando o "porquê" não é óbvio (uma decisão não trivial, um workaround). Não
  documentar o óbvio.

## 6. Testes

Obrigatórios conforme constituição, seção 5:
- **Unitários**: gerador de SKU, schemas Zod, regras de produto, regras de usuário, permissões.
- **Integração**: Fastify + MongoDB, Auth, Products, Users, SKU sequence.
- **E2E**: login, cadastro manual, cadastro por IA, edição, criação/alteração de usuário,
  marcar peça como vendida. Vivem em `e2e/` (Playwright Test), não em `backend/` nem
  `frontend/` — cobrem os dois juntos, contra o cluster de teste dedicado do Atlas.

Rode `npm run lint` e `npm run test` no pacote alterado (`backend/` e/ou `frontend/`) antes de
considerar uma tarefa concluída. Ao terminar uma feature cujas tasks incluem E2E, rode também
`npm test` em `e2e/`.

## 7. Trabalhando com múltiplos agentes e modelos neste repositório

- A fonte de verdade compartilhada entre agentes/modelos é sempre `memory/` e `specs/` —
  **nunca o histórico de uma conversa específica**. Qualquer decisão arquitetural relevante
  tomada por um agente deve ser registrada em `memory/decisions.md` para que outro agente (ou
  outro modelo, em outra sessão) tenha o mesmo contexto.
- Ao trocar de modelo/agente no meio de uma feature, releia `spec.md` → `plan.md` → `tasks.md`
  da pasta em `specs/` correspondente antes de continuar — não assuma que o novo agente tem
  memória da sessão anterior.
- Se dois agentes forem trabalhar em paralelo (ex.: um em `backend/`, outro em `frontend/`),
  cada um deve se restringir à sua pasta e ao contrato definido em `shared/`; mudanças de
  contrato (schemas Zod compartilhados) devem ser coordenadas via spec antes de codificar dos
  dois lados. Para trabalho realmente paralelo no mesmo pacote, use git worktrees separadas em
  vez de duas sessões editando os mesmos arquivos.
- Toda spec deve declarar conformidade com os princípios I–X da constituição, ou justificar e
  registrar formalmente o desvio (constituição, seção 6) — isso vale para qualquer agente que
  gere ou edite uma spec, não só para humanos.
- Ao alterar `memory/constitution.md`, siga
  [`constitution_update_checklist.md`](memory/constitution_update_checklist.md) para propagar
  a mudança às specs afetadas.

## 8. Ordem de leitura recomendada para uma tarefa nova

1. Este arquivo (`AGENTS.md`) e o `AGENTS.md` da subpasta relevante (`backend/`, `frontend/`
   ou `e2e/`).
2. `memory/constitution.md`.
3. `specs/NNN-feature/spec.md` → `plan.md` → `tasks.md` da feature em questão.
4. `memory/glossary.md` para qualquer termo de domínio ambíguo.
5. Código existente relacionado (grep/leitura direta).
