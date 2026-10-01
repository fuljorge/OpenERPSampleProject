# Tasks 004 — Geração de SKU

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Depende de:** [003-categorias/tasks.md](../003-categorias/tasks.md)
**Convenção:** `[P]` = tarefa paralelizável.

## Fase 1 — Testes (a mais crítica do MVP — priorizar)

- [x] T001 [P] Teste unitário `backend/src/services/sku.service.test.ts`: dado
      `BERM.currentValue = 24`, `generateNextSku("BERM")` retorna `ERP-BERM-000025` e
      persiste `currentValue = 25`. 3 casos cobertos (geração simples, categoria inválida
      rejeitada antes de incrementar, zero-padding).
- [x] T002 Teste de **concorrência** `backend/tests/integration/sku-concurrency.spec.ts`:
      disparar N (20) chamadas simultâneas de `generateNextSku("BERM")` contra MongoDB real
      (`mongodb-memory-server`) e assertar N SKUs distintos, sequenciais, sem colisão. **2/2
      passando** — validado também manualmente contra o Mongo de dev real (3 chamadas
      sequenciais para BERM + 1 para VEST, sequências independentes confirmadas).
- [x] T003 `backend/tests/integration/sku-concurrency.spec.ts` (novo `describe` no mesmo
      arquivo): inserir um segundo produto com `sku` já existente é rejeitado pelo índice
      único de `products.sku` (`código 11000`) — retomada agora que 005 criou o índice
      (`mongo.client.ts`/`ensureIndexes`). Testa a garantia de última instância no banco, não
      o `sku.service` (que nunca gera duplicata sozinho, por construção atômica).

## Fase 2 — Implementação core

- [x] T004 [P] Implementar `backend/src/schemas/sku.schema.ts`
      (`SkuSchema`, regex `/^ERP-[A-Z]{3,6}-\d{6}$/`).
- [x] T005 Implementar `backend/src/repositories/sku-sequence.repository.ts`
      (`incrementAndGet(categoryCode)` via `findOneAndUpdate` atômico com `$inc` e
      `upsert: true` — **nunca** ler o valor atual antes de incrementar).
- [x] T006 Implementar `backend/src/services/sku.service.ts` (`generateNextSku(categoryCode)`
      — valida categoria via `category.service.assertCategoryActive` de
      [003](../003-categorias/tasks.md), incrementa via T005, formata com zero-padding) —
      depende de T004, T005 — faz T001 e T002 passarem.

**Validado contra o Mongo de dev real** (sem rota HTTP própria — 004 não tem UI nem API,
testado chamando `generateNextSku` diretamente): `ERP-BERM-000001/2/3` sequenciais,
`ERP-VEST-000001` independente, categoria inexistente rejeitada com a mesma mensagem de
`assertCategoryActive` (003). Documento em `sku_sequences` confere exatamente com o modelo de
dados da spec (`{_id: "BERM", currentValue: 3}`).

## Dependências entre tarefas

```
T004,T005 → T006 → T001,T002 (validação)
T006 é consumido por 005/T00x (criação de produto) e 006/T00x (confirmação via IA)
```

## Nota crítica

`sku.service.generateNextSku` (T006) só pode ser chamado dentro da operação de persistência
final do produto (`POST /api/products` em [005](../005-produtos-cadastro-manual/tasks.md) e
`POST /api/products/confirm` em [006](../006-produtos-cadastro-ia/tasks.md)) — nunca durante
`POST /api/products/analyze`. Qualquer implementação alternativa que leia
`sku_sequences.currentValue` e some 1 manualmente viola o princípio III da constituição e deve
ser rejeitada em revisão de código.
