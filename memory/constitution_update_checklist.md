---
name: constitution_update_checklist
description: Checklist a seguir sempre que memory/constitution.md for alterada, garantindo que specs, plans, tasks e artefatos de código dependentes permaneçam consistentes.
---

# Checklist de Atualização da Constituição

Use esta lista **toda vez** que `memory/constitution.md` for modificada — seja por um novo
princípio, mudança de stack, ou revisão de escopo do MVP. O objetivo é impedir que a
constituição fique dessincronizada das specs que declaram conformidade com ela (cada
`spec.md` possui uma seção "Conformidade constitucional").

## 1. Antes de alterar

- [ ] A mudança é realmente um princípio/regra estável, ou é uma decisão pontual? Decisões
      pontuais (troca de fornecedor, escolha de biblioteca específica) vão para
      [decisions.md](decisions.md), não para a constituição. Só editar `constitution.md`
      diretamente quando a tabela de stack (seção 2) ou um princípio (seção 1) mudar de
      fato.
- [ ] Existe um ADR em [decisions.md](decisions.md) documentando o porquê? Se a mudança tem
      trade-offs (ex.: troca de provedor, adoção de nova tecnologia), registrar o ADR antes
      ou junto desta edição.

## 2. Ao editar `constitution.md`

- [ ] Incrementar **Versão** (semver simples: mudança de princípio/escopo = minor; correção
      de texto sem mudança de sentido = patch) e atualizar **Última alteração**.
- [ ] Se a mudança introduz uma exceção a um princípio existente (I a X), documentar a
      exceção explicitamente no próprio princípio, não deixar implícita.
- [ ] Se a mudança altera a tabela de stack (seção 2), confirmar que há um ADR correspondente
      em [decisions.md](decisions.md) linkado.

## 3. Após editar — propagar para specs dependentes

- [ ] Revisar a seção "Conformidade constitucional" de **cada** `spec.md` em `specs/` — a
      lista atual de specs e o princípio mais relevante para cada uma:

  | Spec | Princípios centrais |
  |---|---|
  | [001-autenticacao](../specs/001-autenticacao/spec.md) | VII (segurança), IX (auditoria) |
  | [002-usuarios](../specs/002-usuarios/spec.md) | VII (RBAC), VIII (exclusão lógica) |
  | [003-categorias](../specs/003-categorias/spec.md) | I (taxonomia fechada para IA) |
  | [004-sku](../specs/004-sku/spec.md) | III (SKU atômico) |
  | [005-produtos-cadastro-manual](../specs/005-produtos-cadastro-manual/spec.md) | III, VIII, IX |
  | [006-produtos-cadastro-ia](../specs/006-produtos-cadastro-ia/spec.md) | I, II (human in the loop) |
  | [007-imagens](../specs/007-imagens/spec.md) | VI (abstração de provedor), VII (upload seguro) |
  | [008-auditoria](../specs/008-auditoria/spec.md) | IX |
  | [009-dashboard](../specs/009-dashboard/spec.md) | VII (RBAC de navegação) |

- [ ] Para toda spec afetada, verificar se `plan.md` e `tasks.md` correspondentes também
      precisam de ajuste (ex.: nova variável de ambiente, novo adapter, nova tarefa de teste).
- [ ] Atualizar [glossary.md](glossary.md) se a mudança introduzir ou renomear um termo de
      domínio.
- [ ] Se a mudança contradiz algo no documento fonte original
      (`Especificação Funcional e Técnica — OpenERP Sample.md`), **não editar o
      documento fonte** — ele é referência histórica imutável. Em vez disso, gerar uma nova
      versão numerada do documento (ex. `(v1.2).md`) com uma nota de versão explicando a
      mudança, como feito em `(v1.1).md` para a troca de provedor de imagens.

## 4. Checklist de consistência final

- [ ] `constitution.md`, seção 2 (stack) reflete exatamente o que está implementado/planejado
      em cada `plan.md`.
- [ ] Nenhuma spec afirma conformidade com um princípio que não existe mais ou que mudou de
      número/conteúdo.
- [ ] O commit da mudança inclui, na mesma alteração ou em sequência imediata, todos os
      arquivos de `specs/` impactados — evitar deixar a constituição à frente das specs por
      mais de um commit.
