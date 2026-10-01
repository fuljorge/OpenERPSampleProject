# Tasks 009 — Dashboard Administrativo

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Depende de:** [005-produtos-cadastro-manual/tasks.md](../005-produtos-cadastro-manual/tasks.md),
[002-usuarios/tasks.md](../002-usuarios/tasks.md) (permissões de menu)
**Convenção:** `[P]` = tarefa paralelizável.

## Fase 1 — Testes

- [x] T001 [P] `backend/src/services/dashboard.service.test.ts` (3 casos): agrega os 6
      indicadores a partir de `countDocuments` mockado (cada chamada identificada pelo filtro
      recebido, não pela ordem); "sem preço"/"sem imagens" excluem `inativo`; "cadastrados
      hoje" filtra a partir do início do dia.
- [x] T002 `backend/tests/integration/dashboard.spec.ts` (3 casos, `mongodb-memory-server`):
      sem autenticação → 401; `viewer` também consulta (nenhuma role adicional exigida); os 6
      campos batem com uma fixture de 8 produtos cobrindo cada combinação de status/preço/
      imagem/data — contagens esperadas derivadas programaticamente da mesma fixture (não
      calculadas à mão), para eliminar erro de aritmética numa combinação com várias variáveis.

## Fase 2 — Implementação core (backend)

- [x] T003 `backend/src/services/dashboard.service.ts` (`getSummary()` — os 6
      `countDocuments` em `Promise.all`) — depende do repositório de produtos
      ([005/T006](../005-produtos-cadastro-manual/tasks.md)) — faz T001 passar.
      **Decisão de implementação (não literal no plan.md)**: "sem preço" e "sem imagens"
      excluem produtos `status: "inativo"` (`$ne: "inativo"`) — são indicadores de "precisa de
      atenção operacional"; um produto já excluído logicamente não deveria inflar essa
      contagem. "Cadastrados hoje" usa o fuso horário do processo do servidor (sem requisito
      de timezone explícito na spec).
- [x] T004 `backend/src/routes/dashboard.routes.ts` (`GET /api/dashboard/summary`, apenas
      `authenticate`, nenhuma `role` adicional) — depende de T003 — faz T002 passar.
- [x] T005 Registrado `backend/src/modules/dashboard.module.ts` em `app.ts`.

**Validado contra o MongoDB Atlas de dev real** via curl: `GET /api/dashboard/summary`
retornou os 6 campos com valores reais consistentes com o catálogo de dev.

## Fase 3 — Frontend

- [x] T006 [P] `frontend/src/services/dashboard.service.ts` (+ `schemas/dashboard.schema.ts`,
      `DashboardSummarySchema` espelhando o backend).
- [x] T007/T008/T009/T010 — **desvio deliberado do plan.md**: não foram criados
      `components/Sidebar.tsx`, `components/Header.tsx`, `components/Loading.tsx` nem
      `layouts/BackofficeLayout.tsx`. O `plan.md` original (layout de referência com menu
      lateral, seção 3 da spec) foi escrito antes de `components/AppLayout.tsx` existir —
      criado em 002-usuarios como cabeçalho horizontal (não sidebar) com navegação já
      filtrada por `role` e já usado por **toda** tela autenticada do app. Construir um
      segundo sistema de layout paralelo (sidebar) só para o dashboard duplicaria
      exatamente o que `AppLayout` já resolve — contra o princípio V (simplicidade,
      "não reinventar mecanismo já existente"). `AppLayout` ganhou um link "Dashboard"
      explícito (primeiro item, antes de "Produtos") apontando para `/`. Loading segue o
      padrão inline já usado em toda página do app (`{isLoading && <p>Carregando...</p>}`),
      sem um componente `Loading.tsx` dedicado. Registrado como
      [ADR-014](../../memory/decisions.md#adr-014--dashboard-reaproveita-applayout-em-vez-de-criar-um-layout-de-sidebar-paralelo).
- [x] T011 `frontend/src/hooks/useDashboardSummary.ts` — depende de T006.
- [x] T012 `frontend/src/pages/DashboardPage.tsx` (6 `Card`s reutilizando `Card.tsx` de
      [005](../005-produtos-cadastro-manual/tasks.md), estados loading/error) — depende de
      T011. Rota `/` (`App.tsx`) trocou o placeholder de "Dashboard em construção" por esta
      página de verdade.

**Validado no navegador** (Playwright, admin real, dados reais de dev): login → `/` → 6 cards
com os indicadores corretos → navegar para `/products` e voltar via link "Dashboard" recarrega
os 6 indicadores sem erro. Sem erros de console além do 401 esperado (pré-login).

## Fase 4 — E2E

- [x] T013 `e2e/tests/dashboard.spec.ts`: login → `/` → heading "Dashboard" visível → os 6
      indicadores visíveis com valor numérico ao lado (sem depender de valores exatos, dado
      real do banco de teste). **Mesmo teste fecha
      [001/T021](../001-autenticacao/tasks.md)** ("login completo até o dashboard") — as duas
      tarefas descreviam o mesmo cenário; 001/T021 ficava bloqueada só esperando 009 existir
      para ter um destino real pós-login. Não fazia sentido duplicar em dois arquivos.

## Dependências entre tarefas

```
T003 → T004 → T005
T006 → T011
T011 → T012
T012 → T013
```
