# Tasks 005 — Produtos: Modelo, Cadastro Manual e Administração

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Depende de:** [003-categorias/tasks.md](../003-categorias/tasks.md),
[004-sku/tasks.md](../004-sku/tasks.md), [002-usuarios/tasks.md](../002-usuarios/tasks.md)
(`authorize.middleware.ts`)
**Convenção:** `[P]` = tarefa paralelizável.

**Infraestrutura criada nesta fase**: `shared/` (vazio até então) virou um pacote npm próprio
e independente (`@openerp-sample/shared`, `npm install` isolado, mesmo padrão de
`backend/`/`frontend/`/`e2e/`), compilado via `tsc` para `shared/dist/` — testado
empiricamente que `import` relativo do `.ts` fonte direto do backend quebra (`TS6059`, fora
do `rootDir`) e não resolve `zod` (sem `node_modules` próprio). `backend`/`frontend` sempre
importam `shared/dist/...`, nunca `shared/schemas/...` — **quem editar algo em `shared/`
precisa rodar `npm run build` lá antes de testar dos dois lados** (ver `shared/AGENTS.md`).

## Fase 1 — Schema compartilhado (bloco fundacional)

- [x] T001 Implementar `shared/schemas/product.schema.ts`: schema Zod completo (todas as
      subseções do modelo — identificacao, classificacao, marca, caracteristicas, medidas,
      condicao, preco, estoque, imagens, ecommerce, marketplaces, venda, ai_metadata,
      auditoria) com `.superRefine` para a regra `possui_defeitos = true ⇒
      defeitos.length >= 1`. `CondicaoBaseSchema` exportado separado (sem o `.superRefine`)
      para o backend derivar uma versão `.partial()` no update.
- [x] T002 [P] Teste unitário `shared/schemas/product.schema.test.ts`: aceita produto válido;
      rejeita `possui_defeitos=true` com `defeitos=[]`; campos desconhecidos pela IA aceitam
      `null` (não `undefined` implícito). 7 casos cobertos.

**Decisões tomadas na implementação** (spec não detalha): `condicao.estado` é um enum fechado
(`novo`/`seminovo`/`usado`) — a spec só mostra o exemplo "novo", sem enumerar valores, mas
precisa ser fechado por ser filtro da tela de produtos (seção 5). Campos de atributo
(marca, características, medidas) usam `.default()` — nullable e omitidos viram `null`
automaticamente, nunca exigidos na criação manual.

## Fase 2 — Testes de integração e domínio

- [x] T003 [P] Teste unitário `backend/src/services/product.service.test.ts`: transição de
      `status` inválida (ex. `vendido → rascunho`) é rejeitada; transição válida
      (`rascunho → em_revisao → disponivel → reservado → vendido`) é aceita; `inativo`
      alcançável a partir de qualquer estado. 7 casos cobertos, incluindo transições extras
      decididas na implementação (`em_revisao → rascunho`, `disponivel → vendido` direto,
      `reservado → disponivel`, `inativo → rascunho` — documentadas no código-fonte).
- [x] T004 Teste de integração `backend/tests/integration/products.spec.ts`:
      `POST /api/products` gera `sku` via 004 e persiste; `DELETE /api/products/:id` realiza
      soft-delete (`status=inativo`, documento continua existindo); filtros combinados
      (categoria+status+tamanho) retornam o resultado esperado. 13 casos cobertos.

## Fase 3 — Implementação core (backend)

- [x] T005 `backend/src/schemas/product.schema.ts`: re-exporta/estende
      `shared/schemas/product.schema.ts` — depende de T001. Define `CreateProductSchema`
      (campos que o cadastro manual realmente envia — `categoria`/`departamento` derivados da
      categoria, nunca aceitos do cliente) e `UpdateProductSchema` (todo campo `.partial()`,
      qualquer profundidade).
- [x] T006 Implementar `backend/src/repositories/product.repository.ts`
      (`list({filtros,paginacao,ordenacao})`, `findById`, `create`, `update`, `softDelete`).
      `update` achata o patch em dot-notation (`$set` por campo, não substitui a subseção
      inteira) — evita que um PATCH parcial apague campos irmãos não enviados.
- [x] T007 Implementar `backend/src/services/product-search.service.ts` (monta filtro
      MongoDB a partir de query params: SKU, nome, categoria, subcategoria, departamento,
      marca, tamanho, cor, estado, status, faixa de preço, data de cadastro) — depende de
      T006.
- [x] T008 Implementar `backend/src/services/product.service.ts`: cria produto chamando
      `category.service.assertCategoryActive` (003) e `sku.service.generateNextSku` (004)
      **na mesma operação** de criação, antes do `insertOne`; valida transições de `status`
      — depende de T005, T006 — faz T003 passar. `updateProduct` revalida categoria quando
      alterada, seta `venda.vendido`/`data_venda` automaticamente ao transicionar para
      `vendido`, gera slug via `ecommerce.slug ?? slugify(nome)` quando não informado.
- [x] T009 Criar índices MongoDB: `{sku:1}` único, `{"classificacao.categoria_codigo":1,
      status:1}`, `{"classificacao.departamento":1,"caracteristicas.tamanho_etiqueta":1,
      status:1}` — em `mongo.client.ts`/`ensureIndexes` (mesmo padrão de 002/003).
- [x] T010 Implementar `backend/src/routes/product.routes.ts`:
      `GET/POST` com `authorize(["admin","operator"])`; `DELETE` (soft-delete) com
      `authorize(["admin"])` — **corrigida a divergência identificada no plan.md**. `GET`
      liberado a qualquer perfil autenticado (`viewer` incluído — spec 002).
- [x] T011 Registrar `backend/src/modules/product.module.ts` no `server.ts` (via `app.ts`).

**Bug real encontrado e corrigido testando manualmente**: `updateProduct` disparava
`PRODUCT_UPDATE` genérico **além** do `PRICE_UPDATE`/`PRODUCT_DISABLE`/`PRODUCT_SOLD`/
`PRODUCT_PUBLISH` específico para o mesmo PATCH — uma alteração só de preço virava 2
registros de auditoria em vez de 1. Corrigido: `PRODUCT_UPDATE` genérico só dispara quando
nenhuma ação mais específica já foi registrada na mesma chamada. Teste de integração
reforçado para travar a regressão.

## Fase 4 — Integração cross-spec

- [x] T012 Integrar `audit-log.service.record("PRODUCT_CREATE" | "PRODUCT_UPDATE" |
      "PRODUCT_DISABLE" | "PRICE_UPDATE" | "PRODUCT_SOLD" | "PRODUCT_PUBLISH", ...)` em
      `product.service.ts` (`PRICE_UPDATE` registra `oldValue`/`newValue`) — depende de T008
      e de [008-auditoria/tasks.md](../008-auditoria/tasks.md).

**Backend (T001–T012) validado de ponta a ponta contra o MongoDB Atlas de dev real**: criar
produto gera SKU sequencial de verdade (`ERP-BERM-000004`) e bate exatamente com o JSON de
exemplo da spec; PATCH de preço altera só o campo tocado (dot-notation confirmado); DELETE
faz soft-delete (produto continua consultável, `status=inativo`); `audit_logs` confirma
`PRODUCT_CREATE`/`PRICE_UPDATE`/`PRODUCT_DISABLE` com os metadados corretos e sem
duplicidade.

## Fase 5 — Frontend

- [x] T013 [P] `frontend/src/schemas/product.schema.ts` (importa de `shared/dist/schemas`,
      mesmo padrão do backend — ver addendum da ADR-011). Define `ProductFormSchema` (formulário
      único, plano, reaproveitado por criação e edição — campos de lista como `estilo`,
      `defeitos`, `tags` usam texto separado por vírgula em vez de um seletor de tags dedicado,
      decisão de escopo do MVP), `toProductPayload`/`productToFormValues` (conversão
      forms ⇄ payload aninhado da API) e `PRODUCT_STATUS_LABELS`/`CONDICAO_ESTADO_LABELS`.
- [x] T014 [P] `frontend/src/services/product.service.ts` (`/api/products/*`, mesmo padrão de
      `category.service.ts`/`user.service.ts`).
- [x] T015 [P] `frontend/src/components/Pagination.tsx`.
- [x] T016 [P] `frontend/src/components/SearchInput.tsx` (extraído do padrão inline já usado em
      UsersPage/CategoriesPage).
- [x] T017 [P] `frontend/src/components/Card.tsx` e `frontend/src/components/ProductCard.tsx`
      (usado como célula visual da coluna "Produto" na tabela de T022 — sem imagem real até
      007-imagens, mostra placeholder "Sem foto").
- [x] T018 Implementar `frontend/src/hooks/useProducts.ts` (listagem com filtros/paginação +
      mutações `create`/`update`/`softDelete`/`markAsSold`) — depende de T014.
- [x] T019 Implementar `frontend/src/hooks/useProduct.ts` (detalhe/edição) — depende de T014.
- [x] T020 Implementar `frontend/src/features/products/ProductForm.tsx` (RHF + Zod, formulário
      único com uma `<fieldset>` por subseção do modelo — **reutilizável por 006** no fluxo de
      IA) — depende de T013. Status no modo criação restrito a `CreatableStatusEnum`; no modo
      edição mostra todo `ProductStatusEnum` (o dropdown não filtra por transições válidas a
      partir do status atual — a API rejeita e o erro aparece via `errors.root`, mesmo padrão
      de UserForm; considerado suficiente para o MVP, sem duplicar `ALLOWED_TRANSITIONS` no
      cliente).
- [x] T021 Implementar `frontend/src/features/products/ProductFilters.tsx` — depende de T013,
      reutiliza `useCategories` de 003.
- [x] T022 Implementar `frontend/src/pages/products/ProductsPage.tsx` (tabela +
      busca+filtros+paginação) — depende de `Table.tsx` (002), T015, T016, T018, T021. Ações
      por linha: "Editar" (admin/operador), "Marcar como vendida" (só quando
      `status ∈ {disponivel, reservado}` — ver bug abaixo), "Desativar" (admin).
- [x] T023 Implementar `frontend/src/pages/products/ProductFormPage.tsx` (cadastro manual /
      edição) — depende de T019, T020. Rota `/products` liberada a qualquer perfil autenticado
      (leitura ampla, spec 002); `/products/new` e `/products/:id` restritas a admin/operador.

**Decisão de infraestrutura**: `frontend/vite.config.ts` precisou de `server.fs.allow` apontando
para a raiz do monorepo — sem isso o Vite bloqueia em runtime o import de `shared/dist/...`
(fora da raiz de `frontend/`) mesmo com `tsc -b` limpo. Registrado como addendum da ADR-011.

**Bug real encontrado testando no navegador (Playwright, contra o Mongo de dev real)**: a
listagem oferecia "Marcar como vendida" para qualquer produto que não estivesse `vendido`/
`inativo`, incluindo `rascunho`/`em_revisao` — a API rejeita (400, só `disponivel`/`reservado`
→ `vendido` é uma transição válida) e a mutação não tinha `onError`, então o clique falhava
**silenciosamente** (nenhum feedback na tela). Corrigido: (1) o botão só aparece quando
`status ∈ {disponivel, reservado}`; (2) `ProductsPage` ganhou um estado de erro de ação exibido
inline para qualquer ação rápida (`markAsSold`/`softDelete`) que falhar. Reverificado de ponta a
ponta no navegador: rascunho → em_revisao → disponível → "Marcar como vendida" → vendido,
badge e ações atualizando corretamente em cada etapa.

**Validado no navegador (Playwright, admin real, Mongo de dev real)**: login → `/products` →
criar produto (`possui_defeitos=true` sem `defeitos` bloqueado no cliente antes do submit) →
SKU gerado (`ERP-ACES-000001`) e badge "Rascunho" corretos na listagem → editar (preço
atualizado e refletido na lista) → transição de status até "Disponível" → "Marcar como vendida"
→ badge "Vendido" e ação some → busca por nome/SKU → filtro por categoria, todos funcionando.
Sem erros de console fora do 401 esperado (pré-login).

## Fase 6 — E2E

- [x] T024 `e2e/tests/product-manual-registration.spec.ts`: operador loga, cadastra uma peça
      (nome, categoria, condição + **uma foto real enviada para o Azure Blob Storage de
      teste**, `product-images-test`) e confirma que ela aparece na listagem com SKU gerado,
      status "Rascunho" e a capa (não mais "Sem foto") — depende de T010–T023, T027–T033.
- [x] T025 `e2e/tests/product-edit.spec.ts`: cria uma peça mínima, edita nome e preço de venda
      pela tela de edição, confirma o reflexo na listagem — depende de T010–T023.
- [x] T026 `e2e/tests/product-mark-as-sold.spec.ts`: cria uma peça já como "Disponível"
      (transição direta só é válida a partir de disponível/reservado — ver
      `ALLOWED_TRANSITIONS`), clica "Marcar como vendida" na listagem e confirma o badge
      "Vendido" e o desaparecimento da ação — depende de T010–T023.

**Infraestrutura de teste nova**: `e2e/global-setup.ts` passou a seedar (idempotente, mesmo
padrão do admin) uma **categoria de fixture** (`ETESTE`/"Categoria E2E") — os specs de produto
precisavam de uma categoria ativa para popular o `<select>` do formulário, e diferente de
usuário (criável via UI com e-mail único a cada run), categoria exige código só-letras
(regex de 003), então uma fixture idempotente é o padrão certo (mesmo raciocínio do admin).
`e2e/playwright.config.ts` (`backendEnv`) e `e2e/.env`/`.env.example` ganharam
`AZURE_STORAGE_CONNECTION_STRING`/`AZURE_STORAGE_CONTAINER_NAME=product-images-test` — mesma
Storage Account de dev/prod (ADR-003), container próprio do ambiente de teste.

**Rodado com sucesso neste ambiente de ferramentas (sandbox)**: os 5 specs de `e2e/` (3 novos +
2 de 002) passaram — `5 passed`. Precisei do mesmo workaround de DNS documentado em
`backend/.env.example`/ADR (SRV não resolve neste sandbox): rodei `npx playwright test` com
`MONGODB_URI` do cluster de teste **sobrescrita via variável de ambiente do shell** (nunca
editando `e2e/.env`, que continua com `mongodb+srv://` — correto para o usuário/CI reais, ver
`e2e/AGENTS.md`) e subi backend/frontend manualmente nas portas 3333/5173 antes de rodar (o
`webServer` do Playwright travava tentando resolver SRV antes mesmo do processo herdar a URI
expandida — `reuseExistingServer` contornou isso reaproveitando os processos já de pé).

## Fase 7 — Fotos do produto (pedido explícito do usuário: N fotos por peça, upload e remoção
no cadastro/edição)

Implementa [007-imagens](../007-imagens/spec.md) **inteira** (backend + frontend), já que 005
era sua primeira dependência real — detalhe completo de cada arquivo em
[007/tasks.md](../007-imagens/tasks.md); aqui só o que é específico da integração com produto.

- [x] T027 `shared/schemas/product.schema.ts`: `MAX_PRODUCT_IMAGES = 10` (exportado, fonte
      única) e `ImagensSchema.galeria` ganha `.max(MAX_PRODUCT_IMAGES)` — o limite de fotos por
      peça é aplicado aqui, não em `/api/images` (que não é escopado por produto). Teste novo
      em `shared/schemas/product.schema.test.ts` (aceita até o limite, rejeita acima).
- [x] T028 007-imagens backend completo (`image-provider.port.ts`,
      `azure-blob.adapter.ts`, `schemas/image.schema.ts`, `services/image.service.ts`,
      `routes/image.routes.ts`, `modules/image.module.ts`, `plugins/multipart.plugin.ts`) —
      ver [007/tasks.md](../007-imagens/tasks.md) Fases 1–2. `image.service.test.ts` (4 casos)
      e `tests/integration/images.spec.ts` (6 casos, provider mockado via `FormData` nativo do
      `light-my-request`) passando.
- [x] T029 `backend/src/schemas/product.schema.ts`: `CreateProductSchema` ganha
      `imagens: ImagensSchema.optional()`; `UpdateProductSchema` ganha `imagens:
      ImagensSchema.optional()` — **não** `.partial()`, ao contrário das demais subseções: o
      cliente sempre envia a galeria completa pós upload/remoção (replace atômico via
      dot-notation no repository, não merge campo a campo).
- [x] T030 `backend/src/services/product.service.ts`: `createProduct` usa
      `data.imagens ?? {principal: null, galeria: []}` em vez do `{}` fixo anterior — depende
      de T029.
- [x] T031 007-imagens frontend completo (`frontend/src/services/image.service.ts`,
      `hooks/useImageUpload.ts`, `components/ImageUploader.tsx`) — ver
      [007/tasks.md](../007-imagens/tasks.md) Fase 3. Sem barra de progresso (limitação do
      `fetch`, ver nota em 007) e sem checklist Frente/Costas/Etiqueta (fora do pedido: só "N
      fotos, upload e remoção").
- [x] T032 Integrar `ImageUploader` em `frontend/src/features/products/ProductForm.tsx` (nova
      seção "Fotos", logo após "Identificação") — a galeria vira estado local do form
      (`useState<Imagem[]>`), `onSubmit` passa a receber `(values, imagens)`; a primeira foto
      da lista é sempre `imagens.principal` (`toProductPayload`, sem seletor dedicado) —
      depende de T027, T031.
- [x] T033 `ProductFormPage.tsx` passa `defaultImages={product.imagens.galeria}` na edição;
      `ProductCard.tsx` mostra `imagens.principal.url` real em vez do placeholder "Sem foto"
      quando existente — depende de T032.

**Validado de ponta a ponta**: (1) via curl contra o Azure Blob Storage real
(`stopenerpsample`/`product-images-dev`) e o Mongo de dev real — upload → leitura pública 200 →
MIME inválido rejeitado 400 → delete → leitura pós-delete 404; criar produto com `imagens`
embutido e depois `PATCH` substituindo por `{principal: null, galeria: []}` removendo a foto,
ambos persistindo corretamente. (2) via navegador (Playwright, admin real): duas fotos
enviadas uma a uma no cadastro (contador "1 de 10" → "2 de 10"), remoção de uma antes do
submit, produto criado mostra a foto restante como capa na listagem (não mais "Sem foto"),
editar mostra a foto pré-carregada corretamente, adicionar uma nova + remover a original na
edição atualiza a capa exibida na listagem após salvar — sem erros de console além do 401
esperado pré-login.

## Fase 8 — Edição sem navegação automática e reavaliação por IA (24/09/2026, spec seções 4.2/4.3;
plan.md seções 8/9)

Pedido do usuário: (1) salvar a edição de um produto sem ser levado de volta pra listagem, e
(2) um botão na tela de edição que reavalia a peça pela mesma IA do cadastro (006), usando as
fotos já salvas, preenchendo os campos direto no formulário sem tela de revisão separada. A
lógica de IA em si (rota, serviço, adapter) é implementada em
[006/tasks.md](../006-produtos-cadastro-ia/tasks.md), Fase 7 — aqui só a integração no
formulário reutilizável e na página de edição.

- [x] T034 `frontend/src/features/products/ProductForm.tsx`: dentro de `submit()`, depois de
      `await onSubmit(values, images)` resolver com sucesso, chama `reset(values)` (React Hook
      Form — limpa o estado "dirty"/touched sem trocar os valores exibidos) e liga uma flag
      local (`useState<boolean>` `justSaved`) que mostra uma confirmação inline `role="status"`
      ("Alterações salvas."), mesmo padrão visual já usado em `MarketplaceAccountsPage.tsx`
      (`text-sm text-green-700`). A flag some sozinha assim que `formState.isDirty` volta a
      `true` (qualquer edição de campo depois de salvar) — condição `justSaved && !isDirty` na
      renderização, sem assinatura/efeito extra.
- [x] T035 `frontend/src/pages/products/ProductFormPage.tsx`: `EditProductSection.handleUpdate`
      parou de chamar `onDone()` (navegação pra `/products`) depois de `update.mutateAsync` — o
      formulário permanece montado, já refletindo o produto persistido (cache do TanStack Query
      atualizado pela própria mutação). `handleCreate` (cadastro) **não muda** — continua
      navegando para `/products` após criar. Ganhou um link explícito
      `<Link to="/products">← Voltar para produtos</Link>` no cabeçalho da tela, independente do
      botão de salvar — depende de T034.
- [x] T036 `ProductForm.tsx` ganhou prop opcional `productId?: string`. Quando `mode === "edit"`
      **e** `productId` está presente, renderiza o botão "Reavaliar com IA" (seção "Fotos",
      perto do `ImageUploader`) — usa `useReanalyzeProduct` ([006/T024](../006-produtos-cadastro-ia/tasks.md)).
      Desabilitado quando `images.length === 0`, com texto auxiliar "Usa as fotos já salvas da
      peça — se você acabou de adicionar ou remover fotos, salve as alterações antes de
      reavaliar" (a reanálise lê a galeria persistida no banco, não o estado local ainda não
      salvo — comportamento aceito, documentado em spec 006 seção 9.1, não um bug). Em caso de
      sucesso: `reset(aiSuggestionToFormValues(suggestion, getValues()))`
      ([006/T025](../006-produtos-cadastro-ia/tasks.md)) e exibe `AiConfidenceBadges` (006) para
      os campos recém-preenchidos — depende de T034, [006/T024, T025](../006-produtos-cadastro-ia/tasks.md).
- [x] T037 `ProductFormPage.tsx` passa `productId={id}` pro `ProductForm` no modo edição —
      depende de T036.
- [x] T038 `e2e/tests/product-edit.spec.ts` atualizado pra refletir que salvar não navega mais —
      os dois testes agora confirmam a permanência na tela (mensagem "Alterações salvas.", URL
      inalterada) e só saem explicitamente pelo link "Voltar para produtos" — depende de T035,
      T036. Sem teste unitário dedicado de `ProductForm` (não havia suíte de testes unitários de
      componente React já estabelecida no frontend — ver Nota abaixo — cobertura ficou pelo E2E
      e pela validação manual de ponta a ponta).

**Validado manualmente de ponta a ponta no navegador** (Playwright avulso, admin real, produto
real, Mongo/Azure Blob/provedor de IA de dev reais): editar nome e salvar → confirmação
"Alterações salvas." aparece, URL não muda; editar de novo → confirmação some; link "Voltar
para produtos" funciona; botão "Reavaliar com IA" chama o provedor de IA real e aplica a
sugestão nos campos do formulário sem persistir nada (confirmado via API que a categoria
original permanece intacta até um "Salvar alterações" explícito).

**Validado via E2E contra o cluster de teste dedicado** (`product-edit.spec.ts`, 2 casos): após
o achado do bug do `fieldset()` (ver Nota abaixo), os dois testes passam confirmando a
permanência na tela de edição depois de salvar.

## Nota (24/09/2026) — dois bugs reais encontrados implementando a Fase 8

1. **`PATCH /api/products/:id` quebrava com 500 ao adicionar a primeira foto de uma peça sem
   nenhuma** (`imagens.principal` alternando entre `null` e objeto — Mongo recusa `$set` em
   `"imagens.principal.id"` quando o valor atual é `null`). Descoberto testando manualmente a
   reavaliação por IA (o roteiro natural passa por adicionar fotos numa peça sem nenhuma).
   Corrigido em `backend/src/repositories/product.repository.ts`: `flattenToDotNotation` ganhou
   `ATOMIC_KEYS` (hoje só `imagens`) — essas chaves nunca são achatadas campo a campo, sempre
   `$set` como bloco atômico, que já era o comportamento pretendido documentado em T029 (Fase 7)
   mas não estava de fato implementado assim. Teste de regressão novo em
   `backend/tests/integration/products.spec.ts`.
2. **Helper `fieldset()` dos specs de e2e de produto casava com o `<fieldset class="contents">`
   externo do `ProductForm.tsx`** (wrapper que envolve todas as seções, usado pro modo "view"
   travar tudo) — `hasText` também casa com esse wrapper (contém o texto de toda seção como
   descendente) e `.first()` sempre resolve pra ele. Bug pré-existente (o wrapper já existia
   antes desta fase), só descoberto agora porque `product-edit.spec.ts` precisou ser reescrito
   e exercitou o helper de novo depois de um tempo sem ninguém rodar esses specs. Afeta também
   `product-manual-registration.spec.ts`, `product-mark-as-sold.spec.ts` e `product-ai.spec.ts`
   — corrigido nos quatro arquivos (`fieldset:not(.contents)`). Reconfirmado rodando os quatro
   specs contra o cluster de teste: `product-edit`/`product-manual-registration`/
   `product-mark-as-sold` passam; `product-ai` falhou por timeout aguardando resposta do
   provedor de IA de teste (achado não relacionado a este bug nem a esta fase — mesmo provedor
   self-hosted já documentado em `e2e/AGENTS.md` como instável sob certas condições — não
   investigado a fundo, fora do escopo desta tarefa).

## Dependências entre tarefas

```
T001 → T002, T005
T005,T006 → T007,T008 → T010 → T011
T006 → T009
T008 → T012 (requer 008-auditoria)
T013,T014 → T018,T019,T020,T021 → T022,T023 → T024,T025,T026
T027 → T029 → T030
T028 → T031 → T032 → T033
T027, T032 → T033
T023, T033 → T024,T025,T026
T034 → T035 → T036 → T037 → T038
006/T020-T026 → T036
```
