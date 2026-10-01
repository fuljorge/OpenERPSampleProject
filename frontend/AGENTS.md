# AGENTS.md — frontend

Instruções específicas para agentes de IA trabalhando em `frontend/`. Complementa o
[`AGENTS.md`](../AGENTS.md) da raiz — leia-o primeiro; princípios da constituição valem aqui
integralmente.

## Stack

React 18 + Vite 8 + TypeScript (strict) + React Router + TanStack Query + React Hook Form +
Zod (via `@hookform/resolvers`).

## Comandos

```bash
npm run dev        # vite — http://localhost:5173
npm run build        # tsc -b && vite build
npm run preview        # preview do build de produção
npm run lint            # eslint .
npm run test              # vitest run
```

Rode `lint` e `test` antes de dar uma tarefa como concluída.

## Estrutura de pastas

```
src/
├── app/            # bootstrap (App.tsx, main.tsx, providers, rotas de topo)
├── assets/           # logos e imagens importadas em componentes (ver seção Assets)
├── components/         # componentes de UI reutilizáveis, sem lógica de domínio
├── features/             # lógica por domínio (auth, products, users, categories...)
├── hooks/                  # hooks reutilizáveis (ex.: wrappers de TanStack Query)
├── layouts/                  # layouts de página (backoffice, auth)
├── pages/                      # componentes de rota
├── schemas/                      # schemas Zod específicos do frontend (formulários)
└── services/                       # clientes HTTP para a API Fastify

public/                # favicon, manifest.json e afins — servidos como arquivo estático na
                        # raiz (ver seção Assets); NÃO fica dentro de src/
```

## Identidade visual

Paleta e tipografia definidas em `src/app/index.css` (Tailwind v4, `@theme`, CSS-first — sem
`tailwind.config.js`), inspiradas no site institucional real (ADR-005 em
`memory/decisions.md`). **Reutilizar sempre estes tokens, nunca introduzir cores ad-hoc**:

- `wine-*` (bordô, ex. `wine-900 #3d0006`) — cor de marca; fundo cheio só na tela de login
  (dramático, "vitrine"), acentos (título, links, botão primário) nas telas de trabalho.
- `gold-*` (dourado, ex. `gold-400 #f1b233`) — acento secundário, usado com moderação.
- `cream-50`/`cream-100` — fundo neutro claro das telas de trabalho (tabelas/formulários
  precisam de contraste alto, não usar `wine` como fundo cheio fora do login).
- `font-display` (Playfair Display) para títulos/marca; `font-sans` (Inter) para o resto.
- Cores semânticas de status (`Badge.tsx`: verde/cinza/vermelho) **não** são substituídas por
  `wine`/`gold` — cor de status carrega significado, não é decoração de marca.
- Toda tela autenticada usa `components/AppLayout.tsx` (cabeçalho com marca + navegação +
  logout) — não reimplementar um wrapper de página do zero.

## Assets (logos, favicon, imagens estáticas)

Vite trata dois tipos de asset de formas diferentes — usar a pasta errada quebra em produção
mesmo funcionando no `npm run dev`:

- **`public/`** — arquivos servidos como estão, por URL absoluta a partir da raiz (ex.:
  `public/favicon.ico` → `/favicon.ico`). Usar para favicon, `manifest.json`, ícones de PWA —
  qualquer coisa referenciada por string de URL (`<link rel="icon" href="/favicon.ico">` no
  `index.html`), nunca por `import`.
- **`src/assets/`** — logos/imagens usadas dentro de componentes React, sempre via `import`
  (`import logo from "../assets/logo.svg"`) — o Vite otimiza, faz hash do nome de arquivo e
  inclui no bundle. Nunca referenciar um arquivo de `src/assets/` por caminho de string
  direto (`/src/assets/logo.svg`) — funciona em dev, quebra no build de produção.
- Prefira SVG para o logo quando disponível (escala sem perda, arquivo menor); PNG só se a
  origem for um raster (ex.: um emblema ilustrado como o da marca).

## Convenções

- Estado de servidor (dados vindos da API) sempre via TanStack Query — não duplicar em
  `useState`/Context sem necessidade.
- Formulários sempre com React Hook Form + resolver Zod; reaproveitar schemas de
  `shared/schemas/` quando o contrato for o mesmo usado no backend, em vez de redefinir.
- Toda operação assíncrona (chamadas de API, especialmente cadastro por IA) deve expor
  explicitamente os estados `loading`, `success`, `error` e `empty` na UI — nunca deixar a tela
  "travada" sem feedback.
- Interfaces comuns devem responder em <2s quando a infraestrutura permitir; operações de IA
  podem demorar mais, mas sempre com feedback visual de progresso.
- Aplicação responsiva (desktop/tablet/smartphone); a tela de cadastro de produto deve ser
  otimizada para captura de fotos direto do celular (mobile-first nessa feature específica).
- Nenhum dado sensível (tokens de sessão) em `localStorage` — sessão via cookies `HttpOnly`
  administrados pelo backend.

## Testes

- **E2E**: login, cadastro manual de produto, cadastro por IA, edição de produto,
  criação/alteração de usuário, marcar peça como vendida.
- **Unitários**: schemas Zod de formulário quando houver lógica condicional (ex.:
  `possui_defeitos = true` ⇒ `defeitos.length >= 1`).
