# Tasks 007 — Imagens

**Spec:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md)
**Depende de:** [001-autenticacao/tasks.md](../001-autenticacao/tasks.md),
[002-usuarios/tasks.md](../002-usuarios/tasks.md) (`authorize.middleware.ts`)
**Convenção:** `[P]` = tarefa paralelizável.

**Implementado dentro do trabalho de [005](../005-produtos-cadastro-manual/tasks.md)** (fotos no
cadastro/edição manual de produto) — 007 não foi adiantada especulativamente, só quando 005
criou a dependência real. Detalhes/decisões completos estão em tasks.md de 005; aqui só o
mapeamento de tarefas.

## Fase 1 — Contrato e testes

- [x] T001 [P] `backend/src/plugins/images/image-provider.port.ts`
      (`upload(buffer, mimeType, extension): Promise<{id, url}>`, `remove(id): Promise<void>`).
- [x] T002 [P] `backend/src/schemas/image.schema.ts` (`ALLOWED_IMAGE_MIME_TYPES` — mapa
      MIME→extensão para jpeg/png/webp —, `MAX_IMAGE_SIZE_BYTES` = 5MB, `UploadedImageSchema`).
      **Desvio do plano original**: "quantidade máxima" não está aqui — `POST /images` não é
      escopado por produto, então o limite (`MAX_PRODUCT_IMAGES`, ver 005) é aplicado no
      `ProductSchema.imagens.galeria.max()` compartilhado, não por request de upload.
- [x] T003 `backend/src/services/image.service.test.ts`: rejeita MIME type inválido e arquivo
      acima do tamanho máximo, ambos **antes** de chamar o provedor (mock injetado via
      `setImageProviderForTesting`, sem tocar env vars do Azure).
- [x] T004 `backend/tests/integration/images.spec.ts`: `POST /api/images` sem autenticação
      retorna 401; `viewer` recebe 403; upload válido (admin/operador) retorna `{id, url}` sem
      o binário; MIME inválido rejeitado com 400 antes do provedor; `DELETE /api/images/:id`
      sem autenticação retorna 401, autenticado delega ao provedor. Provider mockado via
      `light-my-request`'s suporte nativo a `FormData` (Node 18+), sem tocar Azure real.

## Fase 2 — Implementação core (backend)

- [x] T005 `backend/src/plugins/images/azure-blob.adapter.ts` (`AzureBlobImageProvider`,
      classe — mesmo padrão de `OpenAiCompatibleAdapter` de 006: env vars lidas no
      construtor, nunca no import do módulo, para não exigir Azure configurado em testes que
      não tocam upload). `upload` grava `{uuid}.{ext}` e retorna `blockBlobClient.url`
      diretamente — **sem SAS token** (ADR-003: leitura pública a nível de blob, URL estável).
      `remove` chama `deleteIfExists()`.
- [x] T005a `@azure/storage-blob`/`@fastify/multipart` já estavam em
      `backend/package.json`/`.env.example` (adicionados durante o setup de infraestrutura,
      antes desta implementação).
- [x] T006 `backend/src/services/image.service.ts` (`uploadImage`/`removeImage`, valida MIME/
      tamanho via T002 antes de delegar ao provider singleton lazy — instanciado só no
      primeiro uso real, nunca no import do módulo).
- [x] T007 `backend/src/routes/image.routes.ts` (`POST /`, `DELETE /:id`, `authenticate` +
      `authorize(["admin","operator"])`).
- [x] T008 `backend/src/modules/image.module.ts` registrado em `app.ts`, prefixo
      `/api/images`; `backend/src/plugins/multipart.plugin.ts` novo (registra
      `@fastify/multipart` com `limits.fileSize = MAX_IMAGE_SIZE_BYTES`).

**Validado de ponta a ponta contra o Azure Blob Storage real** (`stopenerpsample`,
`product-images-dev`, via curl): upload → leitura pública 200 → MIME inválido rejeitado 400 →
delete → leitura pós-delete 404. `POST /api/products` com `imagens` embutido e `PATCH
/api/products/:id` substituindo `imagens` (replace atômico, não parcial) também validados
contra o Mongo de dev real.

## Fase 3 — Frontend

- [x] T009 [P] `frontend/src/services/image.service.ts` (`POST`/`DELETE /api/images`, mesmo
      padrão `ApiEnvelope`/`parseEnvelope` dos demais services).
- [x] T010 `frontend/src/hooks/useImageUpload.ts` (mutations TanStack Query para upload/
      remoção). **Desvio do plano original**: sem barra de progresso — `fetch` não expõe
      progresso de upload nativamente (exigiria reescrever com `XMLHttpRequest`);
      simplificação de escopo aceita para o MVP, erro tratado via estado local no
      `ImageUploader`.
- [x] T011 `frontend/src/components/ImageUploader.tsx` (`<input type="file" accept="image/*"
      capture="environment" multiple>`, preview em grade com botão de remoção por foto,
      contador "N de `MAX_PRODUCT_IMAGES` fotos"). **Desvio do plano original**: sem checklist
      visual Frente/Costas/Etiqueta/Detalhes/Defeitos nem reordenação manual — fora do pedido
      original de 005 ("N fotos, upload e remoção no cadastro/edição"); a primeira foto da
      lista vira a capa (`imagens.principal`) automaticamente, sem seletor dedicado. Reavaliar
      o checklist quando 006 (cadastro por IA) precisar dele de fato.
      **Integrado a [005](../005-produtos-cadastro-manual/tasks.md)** (`ProductForm.tsx`).
      Reutilização por [006](../006-produtos-cadastro-ia/tasks.md) permanece válida sem
      alteração de contrato.

## Fase 4 — Visualização ampliada (lightbox)

- [x] T012 `frontend/src/components/ImageLightbox.tsx`: overlay `position: fixed` em tela
      cheia, imagem ampliada com `object-fit: contain` (máx. 90vw/90vh, garantindo margem de
      fundo clicável), fecha via clique no fundo, tecla `Esc`, ou botão `×` — clique na própria
      imagem não fecha. Bloqueia scroll do `body` enquanto aberto (restaura no unmount).
- [x] T013 Integrar `ImageLightbox` ao `ImageUploader.tsx`: `onClick` na miniatura abre o
      overlay com a `url` daquela foto (estado local) — depende de T012. **Desvio do desenho
      original**: sem `stopPropagation()` no botão de remover — não é necessário, o botão é
      *sibling* da `<img>` (não está aninhado dentro dela), então o clique nele nunca propaga
      pro `onClick` da imagem; confirmado lendo a árvore de elementos antes de implementar.

## Fase 5 — Escolher foto da galeria, não só a câmera direta

Bug real relatado pelo usuário: no celular, tocar em "+ Foto" abria a câmera direto, sem opção
de escolher da galeria.

- [x] T014 [P] Remover `capture="environment"` de `frontend/src/components/ImageUploader.tsx`
      (mantém `accept="image/*" multiple`) — cadastro/edição manual (005/007).
- [x] T015 [P] Remover `capture="environment"` de
      `frontend/src/features/products-ai/AiIntakeForm.tsx` (input próprio, não reaproveita
      `ImageUploader`) — cadastro por IA (006).
- [x] T016 Validado em celular real pelo usuário: **sem `capture`, o navegador/SO dele abriu
      só a galeria, nunca ofereceu a câmera** — confirma o risco já documentado em plan.md,
      seção 5.2 ("comportamento pode divergir entre navegadores/WebViews"). T014/T015 sozinhas
      não bastam; ver T020.

**Validação automatizada**: e2e `product-manual-registration.spec.ts` roda de ponta a ponta
contra o `ImageUploader` (upload real, miniatura renderiza) — passou. e2e `product-ai.spec.ts`
(AiIntakeForm + AiReviewForm) não pôde ser validado nesta sessão: a chamada real ao provedor de
IA multimodal travou (sem retornar em vários minutos) — falha pré-existente e não relacionada a
esta mudança (nenhum código do fluxo de IA foi tocado; uma chamada de texto puro ao mesmo
provedor respondeu em ~2,6s, isolando o problema à requisição multimodal em si, não a
rede/credenciais).

### Correção: dois botões explícitos (câmera e galeria), não um seletor único

T014/T015 confiavam no seletor nativo do navegador oferecer as duas opções sozinho quando o
input não tem `capture` — não é garantido (T016). Troca pra dois inputs de arquivo distintos,
cada um com seu próprio botão visível, sem depender do comportamento do navegador/SO:

- [x] T020 [P] `ImageUploader.tsx`: dois botões lado a lado no lugar do único "+ Foto" —
      "📷 Tirar foto" (`capture="environment"`, sem `multiple` — captura é sempre uma foto por
      vez) e "🖼️ Galeria" (`multiple`, sem `capture`). Dois refs (`cameraInputRef`,
      `galleryInputRef`) — `handleFiles` agora recebe qual dos dois disparou, pra resetar só o
      input certo depois do upload.
- [x] T021 [P] `AiIntakeForm.tsx`: mesma troca (dois botões/inputs) — sem necessidade de refs
      aqui, já que `handleFiles` é síncrono (não faz upload, só guarda o `File` local — spec
      006), reset via `e.target.value = ""` direto no `onChange`.
- [x] T022 e2e: `product-manual-registration.spec.ts` e `product-ai.spec.ts` atualizados — o
      seletor `input[type="file"]` batia num elemento só antes; agora tem dois no DOM
      (violação de strict mode do Playwright). Corrigido pra
      `input[type="file"]:not([capture])`, mirando o input de galeria (não há câmera num teste
      headless) — depende de T020, T021. Rodado contra o Mongo de teste real (mesmo processo
      de DNS SRV manual documentado nesta sessão) — passou.

## Fase 10 — Lightbox também na listagem de produtos

Pedido do usuário: conferir visualmente se é a peça certa antes de clicar em "Editar", sem
sair da listagem.

- [x] T023 `ProductCard.tsx` (listagem, spec 005): `onClick` na foto de capa abre
      `ImageLightbox` — mesmo componente de T012, estado local próprio, sem conflito com o
      link "Editar" (coluna separada da tabela, o Card não é navegável). Validado com um
      teste e2e ad-hoc (login → `/products` → clicar na miniatura → overlay abre com a URL
      real da imagem → clicar fora fecha) — passou, script descartado depois (não fica no
      repo, cobertura pontual/manual desta sessão).

## Dependências entre tarefas

```
T005a → T005 (adapter precisa do SDK e das env vars)
T001,T002 → T005,T006 → T007 → T008
T009 → T010 → T011
T012 → T013 → T023
T014, T015 → T016 → T020, T021 → T022
```

## Nota

Definir nesta fase, como constantes de configuração (não fixadas pela spec): tamanho máximo
por arquivo (MB) e número máximo de imagens por peça.
