# Spec 009 — Dashboard Administrativo

**Domínio:** Products (agregação), transversal
**Fase:** 1 — Backoffice
**Status:** Draft
**Depende de:** [005-produtos-cadastro-manual](../005-produtos-cadastro-manual/spec.md)

## 1. Visão geral

Tela inicial exibida após autenticação, com indicadores operacionais do catálogo.

## 2. Indicadores (MVP)

```
Produtos disponíveis
Produtos cadastrados hoje
Produtos vendidos
Produtos em revisão
Produtos sem preço
Produtos sem imagens
```

Cada indicador é derivado por consulta agregada sobre `products` (contagem por `status`,
por `identificacao.data_cadastro`, por ausência de `preco.preco_venda`, por
`imagens.galeria` vazio e sem `imagens.principal`).

## 3. Layout de referência

```
┌────────────────────────────────────────────┐
│ Logo            Usuário              Sair │
├───────────┬────────────────────────────────┤
│ Dashboard │                                │
│ Produtos  │          Conteúdo              │
│ Categorias│                                │
│ Usuários  │                                │
│ Config.   │                                │
└───────────┴────────────────────────────────┘
```

Menu lateral visível conforme permissões do perfil logado (ex.: "Usuários" só aparece para
`admin`).

## 4. Critérios de aceite

- Após login bem-sucedido, o usuário é redirecionado ao dashboard.
- Os seis indicadores do MVP são exibidos com valores calculados no momento do carregamento
  (sem necessidade de cache nesta fase).
- Itens de menu para os quais o usuário não tem permissão não são renderizados.

## 5. Fora de escopo (evolução futura)

Faturamento, ticket médio, produtos mais visualizados, categorias mais vendidas, giro de
estoque, margem — dependem de domínios ainda não implementados (vendas, analytics).

## 6. Conformidade constitucional

Respeita o RBAC do princípio VII: indicadores e itens de navegação seguem a mesma matriz de
permissões definida em [002-usuarios](../002-usuarios/spec.md).
