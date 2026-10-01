# Constituição do Projeto — OpenERP Sample

**Versão:** 1.6
**Data de ratificação:** 2026-08-21
**Última alteração:** 2026-09-25
**Fonte:** Especificação Funcional e Técnica — OpenERP Sample (v1.0, 20/08/2026)

Este documento define os princípios inegociáveis do projeto. Toda spec em `specs/` e toda
implementação em `backend/` e `frontend/` devem estar em conformidade com esta constituição.
Qualquer exceção deve ser justificada explicitamente na spec correspondente.

---

## 1. Princípios fundamentais

### I. A IA interpreta; a aplicação decide
A Inteligência Artificial é um mecanismo de **interpretação e sugestão**, nunca de decisão
autônoma sobre regras de negócio. O fluxo é sempre:

```
IA sugere → Zod valida → Backend aplica regras → Usuário revisa → Backend gera SKU → MongoDB persiste
```

A IA NUNCA deve: gerar o número do SKU, acessar o MongoDB diretamente, executar queries
arbitrárias, alterar usuários, criar permissões, modificar estoque diretamente, excluir
produtos, alterar preços sem confirmação humana, ou inventar categorias fora da taxonomia
permitida. Quando um dado não puder ser determinado, a IA retorna `null` — nunca um valor
inventado ou aproximado ("provavelmente X").

**Exceção — medidas de peça (spec 006, seção 7.1; decisão do usuário, 24/09/2026, ajustada em
25/09/2026 — ADR-034):** só para os campos de `medidas.*` (spec 005), a IA pode estimar um valor
em vez de retornar `null`, mesmo sem instrumento de medição visível na foto (uma peça
fotografada nunca tem escala confiável) — uma estimativa de medida é útil o bastante pro
cadastro pra justificar o risco, diferente de uma marca ou categoria inventada. ⚠ Decisão
original (24/09/2026): a IA era obrigada a incluir em `identificacao.descricao` uma frase
avisando que as medidas eram estimadas. **Removida pela ADR-034** (decisão do usuário,
25/09/2026) — a descrição vai direto para os anúncios nos marketplaces, e o aviso ali não era
mais desejado; a estimativa continua sendo gerada normalmente, só sem nenhum aviso textual
associado (risco aceito conscientemente pelo usuário, sem mitigação de sistema). Nenhum outro
campo (marca, categoria, composição, estado, tamanho da etiqueta etc.) tem essa exceção —
continuam sob a regra geral acima, `null` quando não determinável com confiança.

### II. Human in the loop é obrigatório
Nenhum produto gerado por IA é publicado ou persistido automaticamente. O operador sempre
revisa, pode corrigir qualquer campo, e só então confirma o salvamento.

### III. SKU nunca é calculado por leitura-e-soma
É proibido implementar geração de SKU como "buscar último → somar 1 → salvar", pois duas
requisições simultâneas podem colidir. A geração de sequência deve usar sempre uma operação
atômica (`findOneAndUpdate` com `$inc` e `upsert`) na collection `sku_sequences`. Formato:
`ERP-{CATEGORIA}-{SEQUENCIA:6 dígitos}`.

### IV. Zod é o contrato entre todas as camadas
Frontend, Backend, IA e MongoDB só se comunicam através de dados validados por schemas Zod.
Nenhuma entrada é confiável sem validação. Regras condicionais (ex.: `possui_defeitos = true`
⇒ `defeitos.length >= 1`) são validadas antes da persistência, nunca depois.

### V. Simplicidade arquitetural até existir necessidade concreta
Não introduzir microserviços, Kafka, Redis, Kubernetes, LangChain, LangGraph ou filas
distribuídas nesta fase. Esses componentes só entram quando houver uma necessidade real e
demonstrada — nunca por antecipação.

### VI. Integrações externas são abstraídas
Provedor de IA, provedor de imagens (Azure Blob Storage) e o repositório de dados (MongoDB) devem ser
acessados através de camadas de abstração (interfaces/ports), permitindo substituição futura
sem reescrever regras de negócio. Cadeia de dependência obrigatória:

```
React → API Fastify → Application Service → Domain Rules → Repository → MongoDB
```

### VII. Segurança por padrão, não por adição posterior
- Senhas: hash com **Argon2id**, nunca texto puro.
- Sessão: Access Token + Refresh Token, preferencialmente em cookies `HttpOnly`, `Secure`
  (produção) e `SameSite`. Evitar tokens sensíveis em `localStorage`.
- RBAC obrigatório em toda rota sensível: middleware de autenticação → middleware de
  autorização → controller.
- Toda entrada de API validada por Zod; upload valida MIME type, extensão, tamanho e
  quantidade máxima de arquivos.
- Rate limiting obrigatório em `/auth/login` e `/products/analyze` (limite configurável, ex.
  10 análises/minuto/usuário) para evitar brute force e custos inesperados de IA.
- CORS restritivo. Segredos exclusivamente em variáveis de ambiente — `.env` nunca é
  versionado. MongoDB nunca é acessível diretamente pelo frontend.
- Falha de login nunca revela se o e-mail existe; tentativas são auditadas.

### VIII. Exclusão lógica, não física
Usuários e produtos não são fisicamente removidos por padrão. Usuários usam
`status = inactive`; produtos usam `status = inativo`. `DELETE` em produtos deve
preferencialmente executar exclusão lógica.

### IX. Auditoria de operações sensíveis
Toda operação que altera estado relevante (login, usuários, produtos, preços, categorias)
gera um registro em `audit_logs` com usuário responsável, ação, entidade, timestamp e
metadados da alteração (valor antigo/novo quando aplicável).

### X. Peça única, SKU único
Cada peça física possui um SKU único e imutável, mesmo havendo peças aparentemente idênticas.
Índice único em `products.sku` e em `users.email`.

---

## 2. Stack tecnológica (fixada nesta fase)

| Camada | Tecnologia |
|---|---|
| Frontend | React + Vite 8 + TypeScript + React Router + TanStack Query + React Hook Form + Zod + Tailwind CSS v4 (CSS-first, `@theme`) |
| Backend | Node.js + TypeScript + Fastify + Zod + MongoDB Driver oficial |
| Banco de dados | MongoDB Atlas |
| Imagens | Azure Blob Storage (MongoDB armazena apenas id, URL, metadados, ordem e tipo — nunca binário) |
| IA | Modelo multimodal (texto + imagens → structured output), acessado exclusivamente pelo backend |

Mudança de stack requer atualização desta constituição com justificativa registrada. Tailwind
CSS definido como o único caminho de estilo do frontend (antes listado como opção junto de
CSS Modules) — decisão e paleta/tipografia associadas em
[ADR-005](decisions.md#adr-005--identidade-visual-do-frontend-paleta-e-tipografia-inspiradas-no-site-institucional).
Este repositório é uma versão de demonstração do código: CI/CD, deploy e infraestrutura de
produção estão fora do escopo.

---

## 3. Perfis de acesso (RBAC)

Três perfis nesta fase: `admin`, `operator` (operador), `viewer` (consulta). Permissões
detalhadas em [specs/002-usuarios/spec.md](../specs/002-usuarios/spec.md). Regra geral:
operações destrutivas ou de gestão de usuários exigem `admin`; cadastro/edição de produtos
aceita `admin` e `operator`; consulta aceita todos os perfis autenticados.

---

## 4. Escopo do MVP

O MVP contempla exclusivamente: Login, Dashboard, Usuários, Categorias, Produtos (cadastro
manual e por IA), SKU automático, upload de imagens, edição de produto, busca, controle de
status e auditoria básica.

Está explicitamente **fora do MVP**: carrinho, checkout, gateway de pagamento, frete
automatizado, integração com Mercado Livre/Shopee, CRM, fidelidade, recomendação por IA,
precificação automática, BI avançado e multiagentes. Esses itens só devem ser especificados
como evolução, em novas pastas de `specs/`, quando houver decisão explícita de avançar de
fase (ver roadmap na especificação funcional original).

---

## 5. Requisitos não funcionais mínimos

- TypeScript em modo `strict`, ESLint, Prettier.
- Componentização e separação de responsabilidades (camadas da seção 1.VI).
- Testes automatizados obrigatórios para: gerador de SKU, schemas Zod, regras de produto,
  regras de usuário, permissões (unitários); Fastify + MongoDB, Auth, Products, Users, SKU
  sequence (integração); login, cadastro manual, cadastro por IA, edição, criação/alteração
  de usuário, marcar peça como vendida (E2E).
- Interfaces comuns devem responder em menos de 2 segundos quando a infraestrutura permitir;
  operações de IA podem levar mais tempo, mas devem sempre expor estados de `loading`,
  `success`, `error` e `empty`.
- Aplicação responsiva (desktop, tablet, smartphone); o cadastro de produto deve ser
  otimizado para captura de fotos direto do celular.

---

## 6. Governança

- Nenhuma funcionalidade nova é implementada sem uma spec correspondente em `specs/`.
- Toda spec deve declarar explicitamente conformidade com os princípios I a X desta
  constituição, ou justificar e registrar formalmente o desvio.
- Alterações nesta constituição exigem atualização de versão e data, devem ser registradas em
  [decisions.md](decisions.md) quando decorrerem de uma decisão técnica com trade-offs, e
  devem ser propagadas para as specs afetadas seguindo
  [constitution_update_checklist.md](constitution_update_checklist.md).
- O documento fonte completo (`Especificação Funcional e Técnica — OpenERP Sample.md`,
  na raiz do projeto) permanece como referência histórica **imutável**; em caso de conflito,
  esta constituição e as specs em `specs/` prevalecem por serem a versão viva do projeto.
  Quando uma decisão contradiz o documento fonte, gera-se uma nova versão numerada do
  documento (ex.: `(v1.1).md`) em vez de editar o original.
- Terminologia de domínio usada nesta constituição e nas specs segue
  [glossary.md](glossary.md).

## 7. Outros artefatos de `memory/`

| Arquivo | Propósito |
|---|---|
| [glossary.md](glossary.md) | Vocabulário de domínio compartilhado entre constituição, specs, plans e tasks. |
| [decisions.md](decisions.md) | Registro de decisões arquiteturais (ADR) — histórico de escolhas técnicas pontuais, mantido separado da constituição para não misturar princípios estáveis com decisões específicas. |
| [constitution_update_checklist.md](constitution_update_checklist.md) | Checklist a seguir sempre que esta constituição for alterada, para manter specs/plans/tasks sincronizados. |
