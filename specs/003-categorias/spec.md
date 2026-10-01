# Spec 003 — Categorias

**Domínio:** Categories
**Fase:** 1 — Backoffice
**Status:** Draft
**Depende de:** [001-autenticacao](../001-autenticacao/spec.md)

## 1. Visão geral

Taxonomia controlada de categorias de produto, usada tanto no cadastro manual quanto como
vocabulário fechado para a IA e como namespace da sequência de SKU.

## 2. Modelo de dados

Collection `categories`:

```json
{
  "_id": "ObjectId",
  "code": "BERM",
  "name": "Bermudas",
  "department": "Masculino",
  "active": true,
  "createdAt": "ISODate"
}
```

Catálogo inicial de referência:

```
BERM | Bermudas        CALC | Calças          CAMI | Camisas
POLO | Camisas Polo     VEST | Vestidos        JAQU | Jaquetas
BLUS | Blusas           SAIA | Saias           SAPT | Sapatos
BOLS | Bolsas           ACES | Acessórios
```

## 3. Regra de negócio central

Os códigos de categoria são administrados exclusivamente pelo sistema (via este módulo). A
IA **somente** pode selecionar códigos já existentes nesta collection — nunca inventar uma
categoria fora da taxonomia (constituição, princípio I). `code` é a chave usada tanto no SKU
(`ERP-{CATEGORIA}-...`) quanto no `_id` da sequência em `sku_sequences`
(ver [004-sku](../004-sku/spec.md)).

## 4. API

```
GET    /api/categories
POST   /api/categories
PATCH  /api/categories/:id
PATCH  /api/categories/:id/status
```

`POST`/`PATCH` restritos a `role = admin` (administração de categorias é permissão exclusiva
de admin, ver [002-usuarios](../002-usuarios/spec.md)).

## 5. Critérios de aceite

- Criar categoria com `code` único, `name` e `department` válidos.
- Desativar categoria (`active = false`) não afeta produtos já cadastrados, mas impede novo
  uso do código em cadastros futuros (manuais ou por IA).
- A IA, ao sugerir uma categoria não presente na taxonomia ativa, deve ser rejeitada pela
  validação Zod do backend antes de qualquer persistência.

## 6. Fora de escopo

Subcategorias como entidade própria (nesta fase, `subcategoria` é um campo textual livre do
produto, não uma entidade da collection `categories`).

## 7. Conformidade constitucional

Garante que a IA nunca "invente categorias fora da taxonomia permitida" (princípio I) e
registra alterações via `CATEGORY_CREATE`, `CATEGORY_UPDATE`, `CATEGORY_DISABLE`
(ver [008-auditoria](../008-auditoria/spec.md)).
