# Plan 005 — Produtos: Modelo, Cadastro Manual e Administração

**Spec:** [spec.md](spec.md)
**Constituição:** [memory/constitution.md](../../memory/constitution.md)
**Depende de:** [003-categorias/plan.md](../003-categorias/plan.md), [004-sku/plan.md](../004-sku/plan.md)

## 1. Stack técnica

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + TypeScript + Fastify |
| Validação | Zod (schema completo do produto, com regras condicionais — ex. `possui_defeitos`) |
| Banco | MongoDB Atlas, collection `products`, índices compostos (seção 6 abaixo) |
| Frontend | React + Vite 8 + TypeScript + React Router + React Hook Form + Zod + TanStack Query |

## 2. Contexto técnico

Este é o domínio central da aplicação. O schema Zod definido aqui é o contrato reaproveitado
por [006-produtos-cadastro-ia](../006-produtos-cadastro-ia/plan.md) (subset de campos
retornado pela IA) e por [shared/schemas](../../shared/schemas/), já que frontend e backend
validam a mesma estrutura.

## 3. Estrutura de arquivos

```
shared/schemas/
└── product.schema.ts                  # ProductSchema completo (fonte única de verdade)

backend/src/
├── schemas/product.schema.ts          # re-exporta/estende shared/schemas/product.schema.ts
├── repositories/product.repository.ts # list (filtros+paginação), findById, create, update, softDelete
├── services/product.service.ts        # regras de negócio: status transitions, geração de sku via 004
├── services/product-search.service.ts # composição de filtros (seção 4 da spec)
├── routes/product.routes.ts           # GET/POST/PATCH/DELETE
└── modules/product.module.ts

frontend/src/
├── schemas/product.schema.ts          # importa de shared/schemas
├── services/product.service.ts        # chamadas /api/products/*
├── services/image.service.ts          # POST/DELETE /api/images (007)
├── hooks/useProducts.ts               # list com filtros (TanStack Query)
├── hooks/useProduct.ts                # detalhe/edição
├── hooks/useImageUpload.ts            # mutations de upload/remoção de foto (007)
├── pages/products/ProductsPage.tsx    # listagem com busca/filtros/paginação
├── pages/products/ProductFormPage.tsx # cadastro manual / edição
├── features/products/ProductForm.tsx  # formulário completo (RHF + Zod), reutilizado por 006
├── features/products/ProductFilters.tsx
├── components/Table.tsx               # reutilizado de 002
├── components/Pagination.tsx
├── components/SearchInput.tsx
├── components/Card.tsx
├── components/ProductCard.tsx
└── components/ImageUploader.tsx       # upload/preview/remoção de fotos (007), usado no ProductForm
```

## 4. Fluxo de execução (camadas)

```
ProductFormPage (RHF + Zod)
  → product.service.ts (POST /api/products | PATCH /api/products/:id)
  → routes/product.routes.ts (Fastify, authorize(["admin","operator"]))
  → schemas/product.schema.ts (valida Zod, incl. regra possui_defeitos → defeitos.length >= 1)
  → services/product.service.ts
      → assertCategoryActive (003) se categoria informada/alterada
      → sku.service.generateNextSku (004) — apenas na criação/confirmação
  → repositories/product.repository.ts (MongoDB)
  → audit_logs (PRODUCT_CREATE | PRODUCT_UPDATE | PRODUCT_DISABLE | PRICE_UPDATE), ver 008
```

## 5. Passos de implementação

1. `shared/schemas/product.schema.ts`: schema Zod completo espelhando o modelo de dados da
   spec (identificacao, classificacao, marca, caracteristicas, medidas, condicao, preco,
   estoque, imagens, ecommerce, marketplaces, venda, ai_metadata, auditoria), com
   `.superRefine` para a regra `possui_defeitos = true ⇒ defeitos.length >= 1`.
2. `repositories/product.repository.ts`: `list({ filtros, paginacao, ordenacao })`, `findById`,
   `create`, `update`, `softDelete` (`status = "inativo"`).
3. `services/product.service.ts`: cria produto sem `sku` primeiro? **Não** — SKU é atribuído
   dentro da mesma chamada de criação, imediatamente antes do `insertOne`, chamando
   `sku.service.generateNextSku(categoria_codigo)` (ver [004](../004-sku/plan.md)).
   Valida transições de `status` (rascunho → em_revisao → disponivel → reservado → vendido,
   mais `inativo` a qualquer momento por admin).
4. `services/product-search.service.ts`: monta filtro MongoDB a partir de query params
   (SKU, nome, categoria, subcategoria, departamento, marca, tamanho, cor, estado, status,
   faixa de preço, data de cadastro).
5. `routes/product.routes.ts`: `GET/POST` aceitam `admin`+`operator`; `DELETE` (exclusão
   lógica) e alteração de preço podem exigir `admin` conforme regra de negócio final a
   confirmar com RBAC de 002 (spec indica operador também pode alterar preço — manter
   `authorize(["admin","operator"])` em `PATCH`, e `DELETE` como soft-delete acessível a
   ambos os perfis que podem editar produto, salvo decisão contrária do time de produto).
6. Índices MongoDB: `{ sku: 1 }` único, `{ "classificacao.categoria_codigo": 1, status: 1 }`,
   `{ "classificacao.departamento": 1, "caracteristicas.tamanho_etiqueta": 1, status: 1 }`.
7. Frontend: `ProductsPage` (tabela + filtros + paginação), `ProductForm` reutilizável tanto
   no cadastro manual quanto — pré-preenchido — no fluxo de IA (006).
8. Fotos (007, integrado aqui): `ProductForm` embute `ImageUploader` numa seção "Fotos" —
   cada arquivo selecionado sobe imediatamente via `POST /api/images` (Azure Blob), o
   formulário só guarda `{id, url}` retornado; remover uma foto chama
   `DELETE /api/images/:id` e atualiza a lista local. No submit (criação ou edição), a galeria
   inteira (já resultante do upload/remoção) é enviada em `imagens` — a primeira foto vira
   `imagens.principal` automaticamente (`toProductPayload`, `frontend/src/schemas/product.schema.ts`).

## 6. Testes planejados

- Unitário: `product.schema` (regra condicional de defeitos), transições de `status`
  inválidas rejeitadas.
- Integração: `POST /products` gera SKU via 004 corretamente; `DELETE /products/:id` realiza
  soft-delete; filtros combinados retornam resultado esperado.
- E2E: cadastrar peça manualmente, editar peça, marcar peça como vendida (fluxos prioritários
  da constituição, seção 5).

## 7. Riscos / decisões em aberto

- Confirmar com o time se `operator` pode de fato executar soft-delete (`DELETE`) — a spec
  002 lista "excluir logicamente produtos" apenas em permissões de `admin`; ajustar
  `authorize` de `DELETE /api/products/:id` para `["admin"]` antes da implementação final.

## 8. Edição sem navegação automática (spec, seção 4.2 — 24/09/2026)

Sem mudança de backend — reaproveita integralmente `PATCH /api/products/:id` (seção 6) e a
auditoria `PRODUCT_UPDATE` já existente. Mudança é só de frontend:

- `ProductForm.tsx`: dentro de `submit()`, depois de `await onSubmit(values, images)` resolver
  com sucesso, chama `reset(values)` (React Hook Form) — limpa o estado "dirty"/touched sem
  trocar os valores exibidos — e liga uma flag local (`useState<boolean>`) que mostra uma
  confirmação inline `role="status"` ("Alterações salvas."), no mesmo padrão visual já usado em
  `MarketplaceAccountsPage.tsx` (`text-sm text-green-700`). A flag desliga automaticamente na
  próxima alteração de campo (assinatura do `watch()` já usada para `possui_defeitos`).
- `ProductFormPage.tsx` → `EditProductSection`: `handleUpdate` continua chamando
  `update.mutateAsync(...)`, mas **para de chamar `onDone()`** depois — o cache do TanStack
  Query (`useProductMutations`) já é invalidado/atualizado pela mutação, então o formulário
  permanece montado, agora refletindo o produto persistido. Ganha um link explícito
  `<Link to="/products">← Voltar para produtos</Link>` no cabeçalho da tela, independente do
  botão de salvar.
- `handleCreate` (cadastro) **não muda** — `onDone()` continua navegando para `/products` após
  criar, por decisão explícita (spec, seção 4.2).

## 9. Reavaliar por IA (spec, seção 4.3; [006/plan.md, seção 8](../006-produtos-cadastro-ia/plan.md#8-reavaliação-de-produto-existente-24092026) — 24/09/2026)

A lógica de IA (rota, serviço, adapter) é toda de 006 — aqui só a integração no formulário
reutilizável:

- `ProductForm.tsx` ganha uma prop opcional `productId?: string`. Quando `mode === "edit"` **e**
  `productId` está presente, renderiza o botão "Reavaliar com IA" (posição sugerida: seção
  "Fotos", perto do `ImageUploader"), usando o hook `useReanalyzeProduct` (006).
- Botão desabilitado quando `images.length === 0` (a galeria local do form já reflete a
  galeria persistida na entrada em modo edição) — mesmo texto que o backend devolveria em erro,
  evitado no cliente antes de gastar uma chamada de IA. Texto auxiliar ao lado do botão:
  "Usa as fotos já salvas da peça — se você acabou de adicionar ou remover fotos, salve as
  alterações antes de reavaliar" (a reanálise lê a galeria **persistida** no banco, não o
  estado local ainda não salvo — comportamento aceito, não um bug, ver 006 seção 9.1).
- Em caso de sucesso: `reset(aiSuggestionToFormValues(suggestion, getValues()))` — a função de
  006 ganha um segundo parâmetro opcional `base` (a mudança está detalhada no plan de 006) para
  fundir a sugestão nos valores **atuais** do formulário em vez de reiniciar a partir dos
  defaults em branco do cadastro; preço, estoque, e-commerce, status, sku e fotos nunca são
  tocados (garantia estrutural de `AiSuggestedProductSchema`, 006 seção 5/8). Os badges de
  confiança (`AiConfidenceBadges`, 006) aparecem para os campos recém-preenchidos.
- Sem tela de revisão separada — o operador ajusta os campos recém-preenchidos ali mesmo e usa
  o fluxo normal de salvar (seção 8 acima) para persistir.
