# Spec 005 — Produtos: Modelo, Cadastro Manual e Administração

**Domínio:** Products
**Fase:** 1 — Backoffice
**Status:** Draft
**Depende de:** [003-categorias](../003-categorias/spec.md), [004-sku](../004-sku/spec.md),
[007-imagens](../007-imagens/spec.md) (fotos do produto)

## 1. Visão geral

Modelo completo de produto (peça única de brechó) e fluxo de cadastro/edição/administração
manual pelo backoffice. Este é o modelo de dados canônico também consumido pelo cadastro
assistido por IA ([006](../006-produtos-cadastro-ia/spec.md)).

## 2. Modelo de dados

Collection `products`:

```json
{
  "_id": "ObjectId",
  "sku": "ERP-BERM-000025",
  "status": "disponivel",
  "identificacao": {
    "nome": "Bermuda Jeans Stretch Masculina Azul Tamanho 32",
    "descricao": "Bermuda jeans masculina em denim azul...",
    "peca_unica": true,
    "quantidade": 1,
    "data_cadastro": "ISODate"
  },
  "classificacao": {
    "categoria_codigo": "BERM",
    "categoria": "Bermudas",
    "subcategoria": "Bermuda Jeans",
    "departamento": "Masculino",
    "estilo": ["Casual", "Básico", "Urbano"],
    "ocasiao": ["Dia a dia", "Passeio", "Lazer"],
    "estacao": ["Primavera", "Verão"]
  },
  "marca": { "nome": null, "original": null },
  "caracteristicas": {
    "tamanho_etiqueta": "32",
    "tamanho_equivalente": null,
    "genero": "masculino",
    "cor_principal": "Azul Jeans",
    "cores_secundarias": [],
    "estampa": "Lisa",
    "material": ["Jeans", "Denim Stretch"],
    "composicao": null,
    "lavagem": "Média",
    "modelagem": "Reta",
    "elasticidade": "Stretch",
    "fechamento": ["Botão", "Zíper"]
  },
  "medidas": {
    "unidade": "cm",
    "cintura": null, "quadril": null, "gancho": null,
    "comprimento": null, "largura_barra": null,
    "coxa": null, "entrepasso": null, "busto": null,
    "largura_ombro": null, "comprimento_manga": null
  },
  "peso": { "valor": null, "unidade": "kg" },
  "condicao": {
    "estado": "novo",
    "nota": 10,
    "possui_etiqueta": true,
    "possui_defeitos": false,
    "defeitos": [],
    "observacoes": "Peça nova com etiquetas."
  },
  "preco": {
    "preco_original_estimado": null,
    "custo_aquisicao": null,
    "preco_venda": null,
    "preco_promocional": null,
    "moeda": "BRL"
  },
  "estoque": {
    "quantidade": 1,
    "localizacao": { "loja": "Loja Principal", "setor": "Masculino", "arara": null, "posicao": null }
  },
  "imagens": { "principal": null, "galeria": [] },
  "ecommerce": {
    "publicado": false,
    "slug": "bermuda-jeans-stretch-masculina-azul-tamanho-32",
    "titulo_seo": "Bermuda Jeans Stretch Masculina Azul Tamanho 32 Nova",
    "tags": ["bermuda masculina", "bermuda jeans", "jeans masculino", "bermuda stretch", "tamanho 32"]
  },
  "marketplaces": {
    "mercado_livre": { "publicado": false, "id_anuncio": null },
    "shopee": { "publicado": false, "id_anuncio": null }
  },
  "venda": { "vendido": false, "data_venda": null, "canal_venda": null, "valor_venda": null },
  "ai_metadata": { "generated": true, "model": null, "generated_at": null, "fields": {} },
  "auditoria": {
    "criado_por": "ObjectId", "criado_em": "ISODate",
    "atualizado_por": "ObjectId", "atualizado_em": "ISODate"
  }
}
```

`marketplaces` e integrações associadas existem no schema para compatibilidade futura, mas
não têm funcionalidade ativa no MVP (fora de escopo, ver seção 8) — o formato real, em produção,
é a lista de publicações da spec [011](../011-integracao-marketplaces/spec.md#42-modelo-de-dados--productsmarketplaces),
não o objeto fixo do exemplo acima.

`medidas.coxa` e `medidas.entrepasso` (largura da coxa e comprimento da costura interna, mesma
unidade dos demais campos de `medidas`) foram acrescentados para calças, shorts e saias publicarem
no Mercado Livre, que exige a tabela de medidas da peça nesses domínios (spec
[012](../012-conector-mercado-livre/spec.md#35-moda-gênero-tamanho-e-tabela-de-medidas), seção
3.5; ADR-024). Pelo mesmo motivo, `medidas.busto` (largura do busto/peito, T060, 23/09/2026) e
`medidas.largura_ombro`/`medidas.comprimento_manga` (largura do ombro e comprimento da manga,
24/09/2026) foram acrescentados para partes de cima (camisas, blusas, jaquetas, casacos,
vestidos) — cada um confirmado ao vivo por um erro real do Mercado Livre pedindo o atributo
`GARMENT_*` correspondente numa publicação, nunca adicionado por antecipação. Todos os campos
de `medidas` continuam opcionais para a loja física — só a publicação no Mercado Livre exige os
que o domínio pedir.

## 3. Status do produto

`rascunho | em_revisao | disponivel | reservado | vendido | inativo`

Fluxo normal:

```
rascunho → em_revisao → disponivel → reservado → vendido
```

`inativo` é usado para exclusão lógica, alcançável a partir de qualquer estado por ação
explícita de um `admin`.

## 4. Cadastro manual

```
Produtos → Novo Produto → Cadastro Manual
```

Formulário reflete integralmente o modelo de dados acima. Campos calculados/gerados pelo
sistema (`sku`, `auditoria.*`, `ecommerce.slug` se não informado) não são editáveis
diretamente pelo usuário.

### 4.1 Fotos do produto

Cada peça pode ter **N fotos** (`imagens.galeria`, limite de `MAX_PRODUCT_IMAGES` — ver
[007-imagens](../007-imagens/spec.md)). O formulário de cadastro manual permite enviar novas
fotos diretamente (upload para o provedor de imagens, seção 007); na edição, o operador pode
tanto adicionar novas fotos quanto apagar fotos já existentes da peça. A primeira foto da
galeria é usada automaticamente como `imagens.principal` (capa exibida na listagem, seção 5) —
não há seletor dedicado de "foto principal" no MVP.

### 4.2 Edição — salvar sem sair da tela (24/09/2026)

Diferente do cadastro (que, ao salvar pela primeira vez, navega para a listagem de produtos —
comportamento inalterado), a tela de **edição** de um produto já existente permanece na mesma
tela depois de salvar (`PATCH /api/products/:id`) — sem redirecionamento automático para a
listagem. O formulário exibe uma confirmação visual de que as alterações foram salvas e
atualiza seus campos com o produto retornado pela API; a auditoria (`PRODUCT_UPDATE`,
[008-auditoria](../008-auditoria/spec.md)) continua sendo gerada normalmente a cada
salvamento. A tela tem um link/botão explícito "Voltar para produtos", independente do botão
de salvar, para o operador sair quando quiser — a navegação deixa de ser automática, mas
continua disponível a um clique.

Motivação: o operador frequentemente ajusta um produto em várias idas e vindas na mesma
sessão (ex.: salva uma correção, reavalia por IA — seção 4.3 — ajusta o resultado, salva de
novo) e ser devolvido à listagem a cada salvamento obrigava reabrir a edição repetidamente.

### 4.3 Reavaliar por IA (24/09/2026)

A tela de edição de um produto existente tem um botão "Reavaliar com IA", que roda a mesma
análise de IA do cadastro assistido
([006](../006-produtos-cadastro-ia/spec.md#9-reavaliação-por-ia-produto-já-cadastrado)) sobre
as fotos **já cadastradas** da peça (galeria atual — não é preciso reenviar fotos), e preenche
os campos correspondentes do formulário de edição diretamente para revisão — sem sair da tela
de edição e sem uma tela de revisão separada (diferente do cadastro inicial, seção 3 de 006).
O operador ajusta livremente os campos preenchidos e usa o fluxo normal de salvar (seção 4.2)
para persistir; nada é gravado automaticamente pela reavaliação em si. Ver 006, seção 9, para
o fluxo completo, a API e as garantias de segurança/Human in the Loop.

## 5. Administração de produtos

Tela "Produtos" com: busca, filtros, ordenação, paginação, novo produto, edição,
visualização, ativação, desativação, publicação, marcação como vendido.

### Filtros suportados
SKU, nome, categoria, subcategoria, departamento, marca, tamanho, cor, estado da peça,
status, faixa de preço, data de cadastro.

### Layout de referência

```
Produtos
[Buscar pelo nome ou SKU...]
Categoria [Todos]  Status [Disponível]  Tamanho [Todos]
-----------------------------------------------------
Foto   SKU                 Produto              Preço
       ERP-BERM-000025     Bermuda Jeans        R$129,90
       ERP-POLO-000018     Polo Masculina       R$89,90
-----------------------------------------------------
                    [+ Novo Produto]
```

## 6. API

```
GET    /api/products
GET    /api/products/:id
POST   /api/products
PATCH  /api/products/:id
DELETE /api/products/:id
```

`DELETE` deve preferencialmente realizar exclusão lógica (`status = inativo`).
`POST /api/products` aceita `role ∈ {admin, operator}`.

`imagens` (principal + galeria) é aceito tanto em `POST` quanto em `PATCH` — sempre como o
array completo já resultante do upload/remoção feitos via `POST`/`DELETE /api/images` (007)
*antes* da chamada a `products`; nunca um merge parcial como as demais subseções do modelo.

## 7. Índices MongoDB

```javascript
{ sku: 1 }  // unique: true
{ "classificacao.categoria_codigo": 1, status: 1 }
{ "classificacao.departamento": 1, "caracteristicas.tamanho_etiqueta": 1, status: 1 }
```

## 8. Fora de escopo

Carrinho, checkout, gateway de pagamento, publicação real em Mercado Livre/Shopee (os campos
`marketplaces.*` existem no schema, mas a integração é uma fase futura) — ver constituição,
seção "Escopo do MVP".

## 9. Conformidade constitucional

`sku` é sempre atribuído via [004-sku](../004-sku/spec.md) (princípio III), nunca informado
manualmente pelo formulário. Exclusão via `DELETE` segue o princípio VIII (lógica, não
física). Toda criação/edição/publicação/venda gera auditoria
(`PRODUCT_CREATE`, `PRODUCT_UPDATE`, `PRODUCT_DISABLE`, `PRODUCT_PUBLISH`, `PRODUCT_SOLD`,
`PRICE_UPDATE`) — ver [008-auditoria](../008-auditoria/spec.md).
