# Plan 003 — Categorias

**Spec:** [spec.md](spec.md)
**Constituição:** [memory/constitution.md](../../memory/constitution.md)
**Depende de:** [001-autenticacao/plan.md](../001-autenticacao/plan.md), [002-usuarios/plan.md](../002-usuarios/plan.md)

## 1. Stack técnica

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + TypeScript + Fastify |
| Validação | Zod |
| Banco | MongoDB Atlas, collection `categories` |
| Frontend | React + Vite 8 + TypeScript + TanStack Query + React Hook Form + Zod |

## 2. Contexto técnico

Domínio pequeno e estável, mas crítico: é a taxonomia fechada consumida por
[005](../005-produtos-cadastro-manual/plan.md) e [006](../006-produtos-cadastro-ia/plan.md).
A validação de categoria (existência + `active = true`) deve viver em um serviço
compartilhado, não duplicada nos módulos consumidores.

## 3. Estrutura de arquivos

```
backend/src/
├── schemas/category.schema.ts        # CategorySchema, CreateCategorySchema
├── repositories/category.repository.ts  # findByCode, list, create, updateStatus
├── services/category.service.ts      # regras (code único), assertCategoryActive(code) — reutilizado por 005/006
├── routes/category.routes.ts         # GET público-autenticado; POST/PATCH restritos a admin
└── modules/category.module.ts

frontend/src/
├── schemas/category.schema.ts
├── services/category.service.ts       # /api/categories
├── hooks/useCategories.ts             # TanStack Query — usado também nos filtros de 005
└── pages/admin/CategoriesPage.tsx
```

## 4. Passos de implementação

1. `schemas/category.schema.ts`: `code` (regex maiúsculo, 3-6 chars), `name`, `department`,
   `active`.
2. `repositories/category.repository.ts`: índice único em `code`.
3. `services/category.service.ts`: `assertCategoryActive(code)` — lançada por
   [004-sku](../004-sku/plan.md) e pelos serviços de produto antes de persistir/gerar SKU;
   é o ponto único que impede a IA de usar categoria fora da taxonomia (constituição,
   princípio I).
4. `routes/category.routes.ts`: `GET /api/categories` (`authenticate` apenas); `POST`/`PATCH`
   com `authorize(["admin"])`.
5. Seed inicial (script único, não parte do runtime) com o catálogo de referência: BERM,
   CALC, CAMI, POLO, VEST, JAQU, BLUS, SAIA, SAPT, BOLS, ACES.
6. Auditoria: `CATEGORY_CREATE`, `CATEGORY_UPDATE`, `CATEGORY_DISABLE`.
7. Frontend: `CategoriesPage` (admin) e `useCategories` reutilizado como fonte de opções em
   formulários e filtros de produto.

## 5. Testes planejados

- Unitário: `category.service.assertCategoryActive` (categoria inexistente/inativa lança
  erro de validação de negócio, não apenas Zod).
- Integração: `POST /categories` com `code` duplicado retorna erro; `GET /categories` reflete
  apenas ativas quando filtrado.

## 6. Riscos / decisões em aberto

- Se `subcategoria` deve virar entidade própria futuramente (hoje é texto livre no produto,
  conforme spec 005) — reavaliar apenas se houver necessidade real de padronização.
