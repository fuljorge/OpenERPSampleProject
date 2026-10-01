# Plan 004 — Geração de SKU

**Spec:** [spec.md](spec.md)
**Constituição:** [memory/constitution.md](../../memory/constitution.md)
**Depende de:** [003-categorias/plan.md](../003-categorias/plan.md)

## 1. Stack técnica

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + TypeScript + MongoDB Driver oficial (operação atômica `findOneAndUpdate`) |
| Validação | Zod (formato final do SKU) |
| Banco | MongoDB Atlas, collection `sku_sequences`, índice único em `products.sku` |

Este domínio não possui UI própria nem rotas HTTP diretas — é consumido internamente por
[005](../005-produtos-cadastro-manual/plan.md) e [006](../006-produtos-cadastro-ia/plan.md)
no momento da confirmação do produto.

## 2. Contexto técnico

Núcleo mais sensível a condição de corrida do sistema. Implementação deve ser isolada em um
único serviço reutilizável, testado exaustivamente para concorrência.

## 3. Estrutura de arquivos

```
backend/src/
├── repositories/sku-sequence.repository.ts   # incrementAndGet(categoryCode): Promise<number>
├── services/sku.service.ts                    # generateNextSku(categoryCode): Promise<string>
└── schemas/sku.schema.ts                       # SkuSchema (regex: /^ERP-[A-Z]{3,6}-\d{6}$/)
```

## 4. Implementação de referência

```typescript
// repositories/sku-sequence.repository.ts
async function incrementAndGet(categoryCode: string): Promise<number> {
  const result = await db.collection("sku_sequences").findOneAndUpdate(
    { _id: categoryCode },
    { $inc: { currentValue: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return result.currentValue;
}

// services/sku.service.ts
async function generateNextSku(categoryCode: string): Promise<string> {
  const seq = await incrementAndGet(categoryCode);
  return `ERP-${categoryCode}-${String(seq).padStart(6, "0")}`;
}
```

`generateNextSku` é chamado **apenas** dentro do fluxo de confirmação de produto
(`POST /api/products/confirm` e `POST /api/products` do cadastro manual), nunca durante a
análise de IA.

## 5. Passos de implementação

1. `repositories/sku-sequence.repository.ts`: função atômica única de incremento (sem
   leitura prévia do valor — proibido pela constituição, princípio III).
2. `services/sku.service.ts`: formatação `ERP-{CATEGORIA}-{6 dígitos}`; depende de
   [003-categorias](../003-categorias/plan.md) apenas para validar que a categoria existe
   antes de incrementar (evita criar sequências órfãs para códigos inválidos).
3. Índice único em `products.sku` como salvaguarda adicional (ver
   [005](../005-produtos-cadastro-manual/plan.md), seção de índices).
4. Integração em `services/product.service.ts` (de 005/006): SKU só é atribuído no momento
   exato da persistência do produto, dentro da mesma operação de confirmação.

## 6. Testes planejados

- Unitário: `sku.service.generateNextSku` com sequência inicial conhecida
  (`BERM.currentValue = 24` → `ERP-BERM-000025`).
- Integração/concorrência: disparar N requisições simultâneas de confirmação para a mesma
  categoria e assertar N SKUs distintos e sequenciais, sem colisão (teste crítico do MVP —
  ver critério de aceite "concorrência" na spec).
- Integração: tentativa de inserir produto com `sku` duplicado é rejeitada pelo índice único.

## 7. Riscos / decisões em aberto

- Nenhum reset/edição manual de sequência é exposto por API nesta fase — qualquer correção é
  operação manual direta no banco, fora do escopo de UI.
