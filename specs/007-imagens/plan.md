# Plan 007 — Imagens

**Spec:** [spec.md](spec.md)
**Constituição:** [memory/constitution.md](../../memory/constitution.md)
**Depende de:** [001-autenticacao/plan.md](../001-autenticacao/plan.md)

## 1. Stack técnica

> Decisão do projeto (2026-08-22): substitui a sugestão original de Cloudinary (seção 4.4 da
> especificação original) por **Azure Blob Storage** — ver
> [constituição, seção 7](../../memory/constitution.md#7-registro-de-decisões-alterações-desta-constituição).

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + TypeScript + Fastify + `@fastify/multipart` |
| Armazenamento | **Azure Blob Storage** (`@azure/storage-blob`), container privado dedicado (`product-images`) |
| Banco | MongoDB Atlas — apenas metadados (`id`, `url`, `metadados`, `ordem`, `tipo`) embutidos em `products.imagens` |
| Frontend | React + Vite 8 + TypeScript; `<input type="file" accept="image/*" multiple>` — **sem** `capture` (spec, seção 5: com `capture="environment"` o navegador força a câmera direto, sem opção de galeria — bug corrigido nesta revisão) |

## 2. Contexto técnico

Provedor de imagem é acessado via uma porta (`ImageProviderPort`), nunca diretamente pelos
serviços de produto — mesmo padrão de abstração usado para IA em
[006](../006-produtos-cadastro-ia/plan.md) (constituição, princípio VI).

## 3. Estrutura de arquivos

```
backend/src/
├── plugins/images/image-provider.port.ts   # interface: upload(file) => {id,url,...}; remove(id)
├── plugins/images/azure-blob.adapter.ts     # implementação concreta (@azure/storage-blob, AZURE_STORAGE_*)
├── schemas/image.schema.ts                  # ImageMetadataSchema, UploadConstraintsSchema
├── services/image.service.ts                 # valida MIME/tamanho/quantidade, delega ao adapter
├── routes/image.routes.ts                    # POST /images, DELETE /images/:id
└── modules/image.module.ts

frontend/src/
├── components/ImageUploader.tsx    # já referenciado em 006; captura câmera + preview + ordenação
├── services/image.service.ts        # POST/DELETE /api/images
└── hooks/useImageUpload.ts          # TanStack Query mutation com progresso/erro
```

## 4. Fluxo de execução (camadas)

```
ImageUploader (input sem capture — seletor nativo oferece câmera OU galeria)
  → image.service.ts (POST /api/images, multipart)
  → routes/image.routes.ts (authenticate obrigatório)
  → services/image.service.ts
      → valida MIME type, extensão, tamanho, nº máx. de imagens (config)
      → plugins/images/azure-blob.adapter.ts (upload do binário para o container)
  → retorna { id, url, ordem, tipo } → MongoDB guarda somente este metadado em products.imagens
```

## 5. Passos de implementação

1. `plugins/images/image-provider.port.ts`: `upload(buffer, mimeType): Promise<ImageAsset>`,
   `remove(id: string): Promise<void>`.
2. `plugins/images/azure-blob.adapter.ts`: implementação usando `@azure/storage-blob`
   (`BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING)`), gravando no
   container `AZURE_STORAGE_CONTAINER_NAME`; nome do blob `{uuid}.{ext}`; `remove(id)` chama
   `containerClient.getBlockBlobClient(id).deleteIfExists()`. Se leitura pública direta não
   for habilitada no container, gerar URL de leitura via **SAS token** com expiração
   configurável (ex.: `AZURE_STORAGE_SAS_EXPIRY_MINUTES`) no momento da resposta do upload.
3. `services/image.service.ts`: validações obrigatórias antes de qualquer chamada ao
   provedor — MIME type permitido, tamanho máximo por arquivo, extensões permitidas, número
   máximo de imagens por peça (constantes configuráveis).
4. `routes/image.routes.ts`: `POST /images` e `DELETE /images/:id`, ambos exigindo apenas
   `authenticate` (qualquer perfil logado pode fazer upload conforme permissões de operador/
   admin definidas em 002; `viewer` não deve chamar esta rota via UI, mas o backend também
   deve aplicar `authorize(["admin","operator"])` para reforçar a regra).
5. Frontend: `ImageUploader` com checklist visual (Frente/Costas/Etiqueta/Detalhes/Defeitos,
   ver seção 7 da spec), preview e reordenação antes do envio; integra tanto com cadastro
   manual (005) quanto com o fluxo de IA (006).
6. Frontend: `ImageLightbox` — overlay de visualização ampliada ao clicar numa miniatura já
   enviada (spec, seção 6). Ver seção 5.1 abaixo para o desenho técnico.

### 5.1 `ImageLightbox` (visualização ampliada)

Componente novo, reutilizável: `frontend/src/components/ImageLightbox.tsx`.

```
interface ImageLightboxProps {
  url: string;
  onClose: () => void;
}
```

- Renderiza um overlay `position: fixed`, cobrindo a viewport inteira (`inset-0`), com fundo
  escurecido semi-transparente (`bg-black/80` ou equivalente) e `z-index` acima de qualquer
  outro elemento da tela de cadastro/edição.
- A imagem ampliada usa `object-fit: contain` com `max-width`/`max-height` abaixo de 100% da
  viewport (ex. 90vw/90vh) — garante uma margem de fundo clicável em qualquer proporção de
  tela/imagem (spec, seção 6).
- Fecha (`onClose`) em três gatilhos: clique no elemento de fundo (não na imagem — usar
  `stopPropagation()` no `<img>` pra não propagar o clique pro fundo), tecla `Esc` (listener
  `keydown` registrado só enquanto o overlay está montado, removido no cleanup do `useEffect`),
  e um botão `×` fixo num canto do overlay.
- **Sem portal do React** (`createPortal`) — `position: fixed` já é suficiente neste caso,
  já que não há nenhum ancestral com `overflow: hidden`/`transform` entre `ImageUploader` e o
  `<body>` que quebraria o posicionamento fixo (confirmar na implementação; se algum ancestral
  futuro introduzir isso, migrar pra portal é a correção).
- Bloqueio de scroll do fundo enquanto aberto: `document.body.style.overflow = "hidden"` no
  mount, restaurado no unmount (mesmo padrão comum de modal).

`ImageUploader.tsx`: cada miniatura ganha um `onClick` que abre o lightbox com a `url` daquela
imagem (estado local `previewUrl: string | null`). **Desvio do desenho original**: o botão de
remover (`×`) não precisou de `stopPropagation()` — é *sibling* da `<img>`, não aninhado
dentro dela, então o clique nele nunca propaga pro `onClick` da imagem.

`ProductCard.tsx` (listagem de produtos, spec 005): mesmo padrão — `onClick` na foto de capa
(`product.imagens.principal.url`) abre o lightbox com estado local próprio. Card não é um
link/navegação (o botão "Editar" é um `<Link>` separado, em outra coluna da tabela), então não
há conflito de clique com a navegação da linha.

### 5.2 Correção: escolher da galeria além de tirar foto (bug real, spec seção 5)

**Tentativa 1 (removida)**: só remover o atributo `capture="environment"` do
`<input type="file" accept="image/*">`, confiando no navegador/SO oferecer as duas opções
(câmera + galeria) num seletor nativo único. **Não se confirmou na prática** — validado pelo
usuário num celular real: sem `capture`, o navegador abriu só a galeria, nunca ofereceu a
câmera (risco que já tinha sido documentado como possível na seção 7 desta revisão anterior).

**Correção final**: dois `<input type="file">` distintos, cada um atrás do seu próprio botão
visível — sem depender de nenhum comportamento implícito do navegador/SO:

```html
<!-- Botão "📷 Tirar foto" -->
<input type="file" accept="image/*" capture="environment" />

<!-- Botão "🖼️ Galeria" -->
<input type="file" accept="image/*" multiple />
```

`capture` nunca soma com `multiple` de forma útil (captura de câmera é sempre uma foto por
vez, mesmo que o atributo `multiple` esteja presente) — por isso só o input de galeria leva
`multiple`.

Dois lugares têm essa duplicação (nenhum reaproveita `ImageUploader` — histórico, não
desenhado assim de propósito):

- `frontend/src/components/ImageUploader.tsx` (cadastro/edição manual — 005/007): dois refs
  (`cameraInputRef`, `galleryInputRef`) — `handleFiles` passa a receber qual das duas fontes
  disparou o evento, pra resetar (`value = ""`) só o input correspondente depois do upload
  assíncrono terminar.
- `frontend/src/features/products-ai/AiIntakeForm.tsx` (cadastro por IA — 006, input próprio,
  não usa `ImageUploader`): mais simples, sem necessidade de refs — `handleFiles` aqui é
  síncrono (não faz upload, só guarda o `File` localmente — spec 006), reset via
  `e.target.value = ""` direto no `onChange` de cada input.

Nenhuma mudança de contrato, schema ou backend — puramente client-side. Efeito colateral:
os testes e2e que selecionavam o input de foto via `input[type="file"]` (seletor único)
precisaram ser ajustados pra `input[type="file"]:not([capture])` (mira o de galeria, já que
não há câmera num teste headless) — ver `e2e/tests/product-manual-registration.spec.ts` e
`e2e/tests/product-ai.spec.ts`.

## 6. Testes planejados

- Unitário: `image.service` rejeita MIME type inválido, arquivo acima do tamanho máximo, e
  upload além do limite de imagens por peça.
- Integração: `POST /images` sem autenticação retorna `401`; upload válido retorna metadado
  completo (sem binário) pronto para ser referenciado em `products.imagens`.
- `ImageLightbox` (componente novo, sem chamada de API): clique numa miniatura abre o overlay
  com a `url` correta; clique no fundo, `Esc`, e clique no `×` do overlay todos chamam
  `onClose`; clique na própria imagem ampliada não chama `onClose`; clique no botão de remover
  foto não abre o overlay (evento não propaga).
- Dois botões (câmera/galeria, seção 5.2): não testável de forma automatizada de forma
  confiável quanto ao comportamento da câmera em si (fora do controle do app) — mas o e2e
  cobre o caminho de galeria (`input[type="file"]:not([capture])`, upload real, miniatura
  renderiza), e a existência dos dois botões/inputs é verificável estaticamente.

## 7. Riscos / decisões em aberto

- ~~Limites exatos~~ — resolvido na implementação (integrada a 005): `MAX_IMAGE_SIZE_BYTES` =
  5MB por arquivo (`backend/src/schemas/image.schema.ts`); MIME types permitidos: JPEG, PNG,
  WebP. `MAX_PRODUCT_IMAGES` = 10 fotos por peça — mas essa contagem **não** é validada em
  `POST /api/images` (a rota não é escopada por produto); é aplicada no
  `ProductSchema.imagens.galeria.max()` (`shared/schemas/product.schema.ts`), fonte única
  tanto para o schema quanto para o limite exibido no `ImageUploader` do frontend.
- ~~Estratégia de URL~~ — resolvido pelo
  [ADR-003](../../memory/decisions.md#adr-003--topologia-do-azure-blob-storage-1-storage-account-leitura-pública-a-nível-de-blob):
  container com **leitura pública a nível de blob** (opção (a) descrita originalmente aqui),
  em uma única Storage Account (`stopenerpsample`) com containers `product-images-{dev,test,prod}`
  por ambiente. Validado de ponta a ponta (upload → leitura anônima → remoção).
- Checklist visual (Frente/Costas/Etiqueta/Detalhes/Defeitos, seção 7 da spec) e reordenação
  manual de fotos **não foram implementados** — o pedido que motivou esta spec (integrada a
  005) foi só "N fotos, upload e remoção no cadastro/edição"; a primeira foto da galeria vira
  a capa automaticamente, sem seletor dedicado. Reavaliar quando 006 (cadastro por IA)
  precisar do checklist de fato.
- ~~`ImageLightbox` ainda não implementado~~ — implementado e integrado ao `ImageUploader.tsx`
  (T012/T013 de tasks.md), validado via e2e.
- ~~Remoção do `capture="environment"` (confiando no seletor nativo)~~ — **risco confirmado na
  prática** (validado pelo usuário num celular real: sem `capture`, o navegador abriu só a
  galeria, nunca ofereceu a câmera) — substituído pela correção final: dois botões explícitos
  (seção 5.2), que não depende de nenhum comportamento implícito do navegador/SO.
