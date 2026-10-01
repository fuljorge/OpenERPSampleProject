---
name: glossary
description: Glossário de domínio (ubiquitous language) do OpenERP Sample — vocabulário compartilhado entre constituição, specs, plans, tasks e código.
---

# Glossário de Domínio — OpenERP Sample

Este glossário fixa o vocabulário usado consistentemente em toda `specs/`, no código de
`backend/` e `frontend/`, e nesta própria pasta `memory/`. Nomes de campos, coleções e rotas
devem seguir estes termos — não introduzir sinônimos ad-hoc.

Termos em português refletem a linguagem do negócio (o brechó); nomes de código (variáveis,
coleções, rotas) usam os identificadores técnicos indicados entre crases.

## Domínio do negócio

**Brechó**
Loja que revende peças de vestuário e acessórios usados ou seminovos. Contexto de negócio
deste projeto (OpenERP Sample).

**Peça / peça única**
Unidade física individual de produto. Mesmo que duas peças pareçam idênticas (ex.: duas
bermudas do mesmo modelo e tamanho), cada uma é uma peça distinta com seu próprio `sku`
(constituição, princípio X). Campo `identificacao.peca_unica` no modelo de produto.

**SKU**
*Stock Keeping Unit* — identificador único e imutável de uma peça. Formato
`ERP-{CATEGORIA}-{SEQUENCIA de 6 dígitos}` (ex.: `ERP-BERM-000025`). Gerado exclusivamente
por incremento atômico — ver [004-sku](../specs/004-sku/spec.md) e constituição, princípio
III. Nunca confundir com `_id` do MongoDB.

**Categoria**
Classe fechada de produto (ex.: Bermudas, Vestidos), identificada por um `code` de 3–6
letras maiúsculas administrado exclusivamente pelo sistema. Fonte da taxonomia usada tanto
no cadastro manual quanto como vocabulário permitido para a IA — ver
[003-categorias](../specs/003-categorias/spec.md).

**Departamento**
Agrupamento amplo por público (ex.: Masculino, Feminino, Unissexo). Campo `department` da
**categoria** (`categories.department`, obrigatório na criação — ver
[003-categorias](../specs/003-categorias/spec.md), seções 2 e 5), não um campo independente
do produto. Versão anterior deste glossário descrevia `departamento` como campo do produto
(`classificacao.departamento`) — corrigido para bater com o modelo de dados real de 003;
quando 005-produtos for implementada, o departamento exibido/filtrado no produto deriva da
categoria selecionada, em vez de ser digitado separadamente. Não confundir com **Gênero**
(abaixo): departamento é do agrupamento amplo da *categoria inteira*, gênero é da *peça*.

**Gênero (peça)**
Campo opcional `caracteristicas.genero` do **produto** (não da categoria) — um dos 5 valores
fechados `masculino`/`feminino`/`menino`/`menina`/`unissex`, `null` quando não informado (nunca
inventado pela IA, constituição, princípio I). Existe porque o departamento, sendo por
categoria inteira (ex.: toda a categoria "Sapatos" é "Unissexo"), não é preciso o bastante para
publicar em marketplaces cujas categorias específicas exigem gênero da peça e não aceitam um
valor "sem gênero" — ex.: a categoria "Scarpins e Plataformas" do Mercado Livre só aceita
Feminino/Meninas ([012](../specs/012-conector-mercado-livre/spec.md), seção 3.5). Decisão do
usuário, 23/09/2026 — ver [005](../specs/005-produtos-cadastro-manual/spec.md), seção 2.

**Subcategoria**
Refinamento textual livre dentro de uma categoria (ex.: "Bermuda Jeans" dentro de
"Bermudas"). Nesta fase não é uma entidade própria — é apenas um campo do produto.

**Cadastro manual**
Fluxo em que o operador preenche todos os campos do produto diretamente, sem IA. Ver
[005-produtos-cadastro-manual](../specs/005-produtos-cadastro-manual/spec.md).

**Cadastro assistido por IA**
Fluxo em que o operador fornece fotos + uma descrição curta, a IA sugere os atributos
estruturados do produto, e o operador revisa antes de salvar. Ver
[006-produtos-cadastro-ia](../specs/006-produtos-cadastro-ia/spec.md).

**Human in the Loop**
Princípio segundo o qual nenhum dado gerado por IA é persistido ou publicado sem revisão e
confirmação explícita de um humano. Constituição, princípio II.

**Confiança (confidence)**
Grau de certeza que a IA atribui a um campo específico que sugeriu, registrado em
`ai_metadata.fields["<campo>"] = {confidence, source}`. Usado para destacar na UI o que foi
identificado com segurança (✓) e o que precisa de atenção do operador (⚠).

**Status do produto**
Um de: `rascunho`, `em_revisao`, `disponivel`, `reservado`, `vendido`, `inativo`. Fluxo
normal: `rascunho → em_revisao → disponivel → reservado → vendido`; `inativo` é alcançável a
partir de qualquer estado (exclusão lógica). Ver
[005-produtos-cadastro-manual](../specs/005-produtos-cadastro-manual/spec.md#3-status-do-produto).

**Exclusão lógica (soft delete)**
Marcar um registro como `inativo`/`inactive` em vez de removê-lo fisicamente do banco.
Prática padrão para `users` e `products` — constituição, princípio VIII.

**Encerrar anúncio**
Tirar do ar um anúncio `publicado` num marketplace (no Mercado Livre, `status = closed`),
mantendo o registro no ERP com `status = encerrado`. Não é "excluir": o anúncio não é apagado no
marketplace, e o ERP não altera o status da peça. Sempre ação explícita do operador. Ver
[011](../specs/011-integracao-marketplaces/spec.md#47-encerrar-anúncio) e
[012](../specs/012-conector-mercado-livre/spec.md#7-encerrar-anúncio).

**Backoffice**
Painel administrativo interno (Login, Dashboard, Usuários, Categorias, Produtos), usado por
`admin`, `operator` e `viewer`. Distinto do e-commerce público (fora do MVP).

## Perfis e autorização

**RBAC**
*Role-Based Access Control* — modelo de autorização baseado em três perfis fixos nesta fase.

**admin**
Perfil com acesso total: gestão de usuários, categorias, preços, publicação e auditoria.

**operator (operador)**
Perfil operacional: cadastra e edita produtos (manual e por IA), faz upload de imagens,
altera estoque e preço. Não gerencia usuários nem permissões.

**viewer (consulta)**
Perfil somente leitura: consulta produtos, catálogo e estoque.

## Arquitetura e infraestrutura

**Provider Port / Adapter**
Padrão de abstração exigido pela constituição (princípio VI) para toda integração externa
(IA, imagens). O *port* é a interface estável (`AiProviderPort`, `ImageProviderPort`); o
*adapter* é a implementação concreta de um fornecedor específico, substituível sem alterar
regras de negócio. Ver `plugins/ai/` e `plugins/images/` nos plans de
[006](../specs/006-produtos-cadastro-ia/plan.md) e [007](../specs/007-imagens/plan.md).

**Sequência de SKU**
Contador atômico por categoria, persistido na collection `sku_sequences`
(`{_id: <categoria_code>, currentValue: <n>}`), incrementado via `findOneAndUpdate` com
`$inc` — nunca por leitura seguida de soma. Ver
[004-sku](../specs/004-sku/spec.md).

**Auditoria (audit log)**
Registro append-only e imutável de operações sensíveis na collection `audit_logs`. Ver
[008-auditoria](../specs/008-auditoria/spec.md).

**MVP**
*Minimum Viable Product* — escopo mínimo definido na constituição, seção 4: Login, Dashboard,
Usuários, Categorias, Produtos (manual e IA), SKU automático, upload de imagens, edição,
busca, controle de status e auditoria básica.

## Metodologia (uso interno deste repositório)

**Spec-driven design**
Metodologia em que nenhuma funcionalidade é implementada sem antes existir uma especificação
estruturada. Sequência de artefatos por domínio: `constitution.md` (princípios globais) →
`spec.md` (o quê e por quê) → `plan.md` (como, tecnicamente) → `tasks.md` (passos concretos e
testáveis). Ver [memory/constitution.md](constitution.md).

**Constituição**
`memory/constitution.md` — princípios inegociáveis do projeto; qualquer spec que desvie deve
justificar o desvio explicitamente e, se a mudança for estrutural, registrar uma decisão em
[memory/decisions.md](decisions.md).

**ADR (Architecture Decision Record)**
Registro estruturado de uma decisão técnica relevante (contexto, decisão, consequências).
Mantidas em [memory/decisions.md](decisions.md), separadas da constituição para não misturar
princípios estáveis com o histórico de decisões pontuais.
