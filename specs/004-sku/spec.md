# Spec 004 — Geração de SKU

**Domínio:** SKU
**Fase:** 1 — Backoffice
**Status:** Draft
**Depende de:** [003-categorias](../003-categorias/spec.md)

## 1. Visão geral

Geração controlada e concorrência-segura do identificador único de cada peça física.

## 2. Formato

```
ERP-{CATEGORIA}-{SEQUENCIA em 6 dígitos}
```

Exemplos: `ERP-BERM-000001`, `ERP-VEST-000001`, `ERP-POLO-000018`.

`ERP` = prefixo fixo. `CATEGORIA` = `categories.code`. `SEQUENCIA` = contador
atômico por categoria.

## 3. Modelo de dados

Collection `sku_sequences`:

```json
{ "_id": "BERM", "currentValue": 24 }
```

`_id` da sequência é o próprio `code` da categoria.

## 4. Regra fundamental (inegociável)

**Nunca** implementar como "buscar último SKU → somar 1 → salvar" — duas requisições
simultâneas podem gerar o mesmo número. Usar sempre incremento atômico equivalente a:

```javascript
db.sku_sequences.findOneAndUpdate(
  { _id: "BERM" },
  { $inc: { currentValue: 1 } },
  { upsert: true, returnDocument: "after" }
)
```

O valor retornado (ex.: `25`) é formatado com zero-padding para 6 dígitos e concatenado ao
prefixo `ERP-{CATEGORIA}-`.

## 5. Quando o SKU é gerado

Apenas no momento da **confirmação** do produto (`POST /api/products/confirm`), nunca durante
a análise de IA (`POST /api/products/analyze`) e nunca no cadastro manual antes da validação
final. Ver [005](../005-produtos-cadastro-manual/spec.md) e
[006](../006-produtos-cadastro-ia/spec.md).

## 6. Índices

Índice único em `products.sku` (`unique: true`) como salvaguarda adicional contra colisão.

## 7. Critérios de aceite

**Geração simples**
DADO `BERM.currentValue = 24`, QUANDO um novo produto da categoria BERM for confirmado,
ENTÃO deve ser criado o SKU `ERP-BERM-000025` e `BERM.currentValue` deve passar a `25`.

**Concorrência**
DADAS duas requisições simultâneas, QUANDO ambas cadastrarem uma peça da categoria Bermudas,
ENTÃO os SKUs gerados devem ser distintos (ex.: `ERP-BERM-000025` e `ERP-BERM-000026`).
Nunca podem existir dois produtos com o mesmo SKU — validado tanto pela atomicidade do
incremento quanto pelo índice único em `products.sku`.

## 8. Conformidade constitucional

Implementa diretamente o princípio III (SKU nunca calculado por leitura-e-soma) da
[constituição](../../memory/constitution.md).
