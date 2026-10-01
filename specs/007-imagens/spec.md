# Spec 007 — Imagens

**Domínio:** Images
**Fase:** 1/2 — Backoffice / Cadastro inteligente
**Status:** Draft
**Depende de:** [001-autenticacao](../001-autenticacao/spec.md)

## 1. Visão geral

Upload, armazenamento e gerenciamento das fotografias das peças, usadas tanto no cadastro
manual/edição quanto como entrada do cadastro assistido por IA.

## 2. Armazenamento

Provedor: **Azure Blob Storage** (Blob Container dedicado, ex. `product-images`). Acesso
sempre através de uma abstração de provedor de imagens (constituição, princípio VI), para
permitir troca futura de provedor sem impacto nas regras de negócio.

Cada imagem é enviada como um blob (nome sugerido: `{productId ou uploadId}/{uuid}.{ext}`)
no container configurado. A URL pública/assinada retornada pelo Azure é o valor persistido
em `products.imagens.*.url`.

O MongoDB (embutido em `products.imagens`) armazena **apenas**: identificador, URL,
metadados, ordem e tipo da imagem. Os arquivos binários nunca são armazenados diretamente
nos documentos de produto.

### Acesso e segurança do blob

- Container configurado como privado; leitura das imagens é feita via URL com **SAS token**
  de leitura (com expiração) gerada pelo backend, ou via CDN/Front Door na frente do storage
  account, quando publicação de e-commerce exigir URLs públicas de longa duração
  (fase futura — fora do MVP).
- Escrita (upload) e exclusão de blobs ocorrem **exclusivamente** pelo backend, autenticado
  com a connection string / credencial do storage account — nunca exposta ao frontend.

## 3. API

```
POST   /api/images
DELETE /api/images/:id
```

Upload permitido somente para usuários autenticados.

## 4. Validações obrigatórias no upload

- MIME type permitido (apenas imagens).
- Tamanho máximo por arquivo.
- Número máximo de imagens por peça.
- Extensões permitidas.

Falha em qualquer validação rejeita o upload antes de qualquer chamada ao provedor de
armazenamento.

## 5. Captura no celular

**Correção de bug (2026-09-15)**: o input original usava o atributo `capture="environment"`,
que em boa parte dos navegadores mobile (Chrome/Android, Safari/iOS) força a abertura direta
da câmera, **sem oferecer a opção de escolher uma foto já existente na galeria**. Relatado
pelo usuário como bug real de uso — quem já tinha a foto tirada não conseguia reutilizá-la, só
fotografar de novo.

**Primeira tentativa de correção** (removida): tirar o atributo `capture`, deixando o
navegador/SO decidir o que mostrar. Em teoria os dois principais mobile (iOS Safari, Android
Chrome) apresentariam as duas opções num seletor nativo único. **Não se confirmou na
prática** — validado pelo usuário num celular real: sem `capture`, o navegador abriu só a
galeria, nunca ofereceu a câmera. Comportamento do seletor nativo não é confiável o bastante
pra depender dele sozinho.

**Correção final: dois inputs de arquivo distintos, cada um com seu próprio botão visível**,
sem depender do navegador/SO oferecer as duas opções:

```html
<!-- Botão "Tirar foto" — força a câmera, sempre uma foto por vez -->
<input type="file" accept="image/*" capture="environment" />

<!-- Botão "Galeria" — nunca abre a câmera, permite selecionar várias de uma vez -->
<input type="file" accept="image/*" multiple />
```

Cada botão é um alvo de toque separado e visível na tela — não depende de nenhum menu/seletor
intermediário do sistema operacional, então o comportamento é previsível em qualquer
navegador/WebView.

Fluxo desejado no cadastro por peça (inalterado, agora com escolha explícita entre os dois
botões a cada foto):

```
Abrir cadastro → Adicionar frente (📷 ou 🖼️) → Adicionar costas → Adicionar etiqueta
   → Informar descrição → Analisar com IA
```

## 6. Visualização ampliada (lightbox)

Ao clicar em qualquer miniatura já enviada, a foto abre **ampliada** sobre um overlay que cobre
a tela atual, sem navegar para outra rota/URL — a tela de origem continua montada por baixo,
com o estado intacto. Dois lugares:

- `ImageUploader` — cadastro manual e edição de produto (005), reutilizado pelo cadastro por
  IA (006).
- **Listagem de produtos (005)** — capa do produto (`ProductCard`, coluna "Produto" da
  tabela): clicar amplia a foto pra conferir se é a peça certa antes de clicar em "Editar"
  (link separado, sem navegar sozinho ao clicar na foto).

```
Miniatura (clique) → overlay em tela cheia, fundo escurecido semi-transparente
                       + imagem ampliada centralizada (object-fit: contain,
                         nunca ocupa 100% da viewport — sempre sobra uma margem
                         de fundo clicável em qualquer proporção de tela/imagem)
```

**Fechar o overlay e voltar exatamente à tela anterior** (sem perda de estado do formulário)
acontece por qualquer uma destas ações:

- Clicar em qualquer área fora da imagem ampliada (o fundo escurecido).
- Pressionar a tecla `Esc`.
- Clicar num botão de fechar (`×`) visível sobre o overlay — necessário porque, em telas
  pequenas (celular), a margem "fora da imagem" pode ser estreita ou de difícil precisão via
  touch.

Clicar **na própria imagem ampliada** (não no fundo) não fecha o overlay — evita fechamento
acidental ao tentar dar zoom/pinch em touch.

O botão existente de remover foto (`×` sobre a miniatura, já implementado) continua
funcionando de forma independente: clicar nele remove a foto sem abrir o overlay ampliado;
só o clique na própria miniatura (fora da área do botão de remover) abre a visualização.

Escopo: aplica-se só a fotos já enviadas (com `url` real do Azure Blob Storage) — o
`ImageUploader` já só exibe miniaturas depois do upload concluído (seção 1), então não há
caso de abrir o lightbox para uma foto ainda em upload.

## 7. Imagens recomendadas por peça

1. Frente, 2. Costas, 3. Etiqueta, 4. Detalhes, 5. Defeitos (se existentes). O sistema deve
orientar o usuário nesta ordem/checklist tanto no cadastro manual quanto no cadastro por IA.

## 8. Critérios de aceite

- Upload de imagem fora do MIME type permitido é rejeitado com erro claro.
- Upload acima do tamanho máximo configurado é rejeitado.
- Excedido o número máximo de imagens por peça, novos uploads são bloqueados até remoção de
  alguma existente.
- Usuário não autenticado recebe `401`/`403` ao tentar `POST /api/images`.
- No celular, dois botões visíveis e independentes cobrem "tirar foto agora" e "escolher da
  galeria" — nenhum dos dois depende do outro nem de um seletor intermediário do sistema.
- Clicar numa miniatura já enviada abre a foto ampliada sobre a tela atual.
- Clicar fora da imagem ampliada, pressionar `Esc`, ou clicar no botão `×` do overlay fecham a
  visualização e retornam à tela anterior sem perda de estado do formulário.
- Clicar dentro da própria imagem ampliada não fecha o overlay.
- Clicar no botão de remover foto (sobre a miniatura) continua removendo a foto normalmente,
  sem abrir o overlay ampliado.

## 9. Fora de escopo

Edição de imagem (crop/filtros) no backoffice, CDN/Front Door próprio na frente do Blob
Storage — usar os recursos nativos do provedor enquanto não houver necessidade concreta de
URLs públicas de longa duração (ex. e-commerce público, fase 3 do roadmap). Navegação entre
fotos (anterior/próxima) dentro do overlay ampliado, zoom/pinch além do que o navegador já
oferece nativamente, e reordenação de fotos por arrastar — nenhum desses foi pedido; avaliar
só se surgir necessidade real de uso.

## 10. Conformidade constitucional

Aplica o princípio VI (abstração de integrações externas) e a regra de segurança de upload
do princípio VII da [constituição](../../memory/constitution.md). A escolha de Azure Blob
Storage substitui a sugestão original de Cloudinary do documento fonte (seção 4.4) — registro
da decisão em [constituição, seção 7](../../memory/constitution.md#7-registro-de-decisões-alterações-desta-constituição).
