# AGENTS.md — shared

Instruções específicas para agentes de IA trabalhando em `shared/`. Complementa o
[`AGENTS.md`](../AGENTS.md) da raiz — leia-o primeiro.

## O que é

Schemas Zod compartilhados entre `backend/` e `frontend/` — fonte única de verdade para
modelos de domínio usados nos dois lados (hoje: `ProductSchema`, consumido também por
006-produtos-cadastro-ia). Pacote npm independente (`@openerp-sample/shared`), com seu próprio
`node_modules`/`package-lock.json` — mesmo padrão de isolamento de `backend/`, `frontend/` e
`e2e/`.

## Por que é um pacote compilado, não `import` direto do `.ts`

Testado empiricamente: `backend/` tem `rootDir: "src"` no `tsconfig.json`, então importar
`../../shared/schemas/product.schema.ts` (fonte bruta) por caminho relativo quebra `tsc`
com `TS6059 (File is not under 'rootDir')` tanto em `--noEmit` quanto no build real. **Não
existe workspace npm neste projeto** (cada pacote — `backend/`, `frontend/`, `e2e/`,
`shared/` — tem instalação própria e independente) — migrar pra workspaces resolveria isso,
mas é uma mudança de infraestrutura muito mais ampla do que o necessário só para compartilhar
um schema.

Solução adotada: `shared/` compila para `shared/dist/` (`npm run build`, `tsc`), e
`backend`/`frontend` importam o **build compilado**, nunca o `.ts` fonte:

```ts
// backend/src/schemas/product.schema.ts ou frontend/src/schemas/product.schema.ts
import { ProductSchema } from "../../../shared/dist/schemas/product.schema.js";
```

## ⚠️ Sempre rebuildar depois de editar

**Se você mudar algo em `shared/schemas/*.ts`, rode `npm run build` aqui antes de testar em
`backend/` ou `frontend/`** — como eles importam `shared/dist/`, não o `.ts` fonte, uma
mudança não aparece do outro lado até o rebuild. Não há watch mode automático configurado
(mantido simples de propósito — constituição, princípio V); se isso incomodar no dia a dia,
considerar `tsc --watch` manual num terminal à parte enquanto edita `shared/`.

## Comandos

```bash
npm install       # primeira vez
npm run build      # gera shared/dist/ — rodar sempre que mudar algo aqui
npm run lint         # eslint .
npm run test           # vitest run — roda direto no .ts fonte, não precisa de build antes
```

## Convenções

- Todo schema aqui é `.ts` puro (sem dependência de Fastify, React, MongoDB driver etc.) —
  se algo só faz sentido de um lado (ex.: schema de query string do Fastify), não pertence
  aqui.
- Campos nullable (`z.nullable()`) representam "a IA não conseguiu determinar" (constituição,
  princípio I) — nunca modelar como `undefined` implícito para esse caso.
