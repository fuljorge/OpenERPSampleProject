# Especificação Funcional e Técnica  
## ERP SAMPLE para Brechó

**Versão:** 1.6  
**Data:** 18/09/2026  
**Tipo de aplicação:** E-commerce + Backoffice Administrativo + Cadastro de Produtos Assistido por IA

---

## Notas de versão — 1.6 (18/09/2026)

Alteração em relação à v1.5: adicionado o atributo **`peso`** ao modelo de produto (seção
19) — objeto com `valor` (decimal, em kg) e `unidade` fixa `"kg"`, seguindo o mesmo padrão já
usado em `medidas` (`unidade` compartilhada) e `preco` (`moeda`). Campo opcional, como as
demais medidas.

---

## Notas de versão — 1.5 (18/09/2026)

Alteração em relação à v1.4: adicionados **requisitos de segurança das credenciais de
integrações de marketplace** (ainda não implementados, apenas especificados) à extensão de
multi-conta desenhada na v1.4 (seção 81). Trechos afetados:

- **Seção 10** (Perfis de acesso): explicitado que **visualizar** configurações/credenciais de
  contas de marketplace, além de criar/editar/desativar, é restrito ao ADMIN; o OPERADOR não
  pode nem visualizar.
- **Seção 35** (Operações auditáveis): adicionados os eventos de criação, alteração,
  desativação e visualização de contas de marketplace à lista de operações que devem gerar
  registro de auditoria.
- **Seção 46** (Requisitos de segurança): adicionados bullets sobre criptografia de
  credenciais de integrações externas e proteção contra spoofing/vulnerabilidades nas
  integrações de marketplace.
- **Seção 81** (nova subseção "Segurança das credenciais"): armazenamento criptografado,
  nunca exibir a credencial completa após salva, proteção contra spoofing e outras
  vulnerabilidades específicas de integrações externas, e acesso restrito ao ADMIN.

---

## Notas de versão — 1.4 (18/09/2026)

Alteração em relação à v1.3: desenhada a extensão de **múltiplas contas por marketplace
(multi-loja)** — ainda não implementada, apenas especificada (seção 81, nova). Até aqui, o
documento modelava cada marketplace como uma credencial única e fixa ("a credencial da loja,
configurada uma vez"), o que impedia publicar a mesma peça em duas contas diferentes do mesmo
marketplace (ex.: duas lojas distintas no Mercado Livre). Trechos afetados:

- **Seção 10** (Perfis de acesso): adicionada a permissão de cadastrar/gerenciar contas de
  marketplace ao perfil ADMIN; explicitado que o OPERADOR não pode gerenciar essas contas,
  só publicar usando contas já cadastradas.
- **Seção 19** (Modelo completo de produto): campo `marketplaces` deixa de ser um objeto fixo
  com uma entrada por nome de marketplace e passa a ser uma **lista de publicações**, uma por
  combinação (marketplace + conta) — permitindo zero, uma ou várias publicações por peça,
  inclusive mais de uma no mesmo marketplace.
- **Seção 79** (Módulo de integração com e-commerce): fluxo de publicação ganha o passo
  "escolhe a conta/loja"; a linha sobre credencial "configurada uma vez" é substituída por
  credencial por conta; a regra de baixa manual passa a considerar todas as publicações ativas
  da peça, não só uma.
- **Seção 80** (Roadmap de conectores): nota de que suporte a múltiplas contas é requisito de
  base de cada conector, não uma evolução separada por marketplace.
- **Seção 81 (nova)**: "Múltiplas contas por marketplace (multi-loja)" — cadastro de contas,
  regras de negócio, fluxo de publicação atualizado e itens fora do escopo desta extensão.

---

## Notas de versão — 1.3 (17/09/2026)

Alteração em relação à v1.2: **reprioridade do roadmap** (seção 75) — venda via marketplaces
passou a ser priorizada sobre a construção de um e-commerce próprio. "Marketplaces" (antes
Fase 5) e "Inteligência comercial" (antes Fase 6) tornam-se **Fase 3** e **Fase 4**;
"E-commerce" e "Venda" (loja própria, antes Fase 3 e Fase 4) tornam-se **Fase 5** e **Fase 6**,
despriorizadas. Fases 1 e 2 (Backoffice, Cadastro inteligente) não mudam de posição. Referência
cruzada corrigida na seção 79 (era "Fase 6", passa a ser "Fase 4 — Inteligência comercial").

---

## Notas de versão — 1.2 (17/09/2026)

Alteração em relação à v1.1: adicionado o **módulo de integração com e-commerce** (camada de
conectores por marketplace), até então só mencionado como preparação futura (seção 1) e item
de roadmap (seção 74, "Fora do MVP", e seção 75, Fase 5). Trechos afetados/adicionados:

- **Seção 19** (Modelo completo de produto): exemplo de `marketplaces` enriquecido com os
  campos que a publicação de anúncio precisa (status, URL do anúncio, data de publicação,
  erro) e adicionado o marketplace `ebay`.
- **Seção 74** (Fora do MVP): nota cruzada pra seção 79 — Mercado Livre/Shopee/eBay continuam
  fora do MVP original (specs 001–010, já implementado), mas agora têm evolução detalhada.
- **Seção 75** (Roadmap sugerido, Fase 5 — Marketplaces): adicionado eBay à lista e referência
  à seção 79.
- **Seções 79 e 80 (novas)**: regras de negócio do módulo de integração com e-commerce —
  camada de conectores (um adapter por marketplace), ordem de implementação (Mercado Livre →
  Shopee → eBay → demais), e o fluxo de publicação de anúncio a partir da tela do produto.

Demais seções permanecem inalteradas em relação à v1.1.

---

# 1. Visão do produto

O sistema **ERP SAMPLE** será uma aplicação web destinada à gestão e comercialização de peças únicas de brechó.

A aplicação deverá contemplar:

- catálogo de produtos;
- cadastro de peças únicas;
- cadastro assistido por Inteligência Artificial;
- análise de fotografias das peças;
- geração automática de informações do produto;
- geração controlada de SKU;
- administração do catálogo;
- autenticação;
- autorização baseada em perfis;
- criação e gestão de usuários;
- controle de estoque;
- gerenciamento de preços;
- gerenciamento de imagens;
- preparação para publicação em e-commerce;
- integração com marketplaces externos via camada de conectores, com suporte a múltiplas
  contas por marketplace (seções 79, 80 e 81).

Cada peça física deverá possuir um **SKU único**, mesmo que existam outras peças aparentemente iguais.

---

# 2. Objetivo principal

Reduzir o trabalho manual necessário para cadastrar peças no brechó.

O operador deverá poder:

1. tirar fotografias da peça;
2. enviar as imagens para o sistema;
3. digitar uma pequena descrição, por exemplo:

> Bermuda Jeans Stretch masculina nova tamanho 32.

4. solicitar a análise pela IA;
5. receber automaticamente:
   - nome;
   - descrição;
   - categoria;
   - subcategoria;
   - departamento;
   - estilo;
   - ocasião;
   - estação;
   - cor;
   - material;
   - tamanho;
   - condição;
   - características;
   - tags;
   - título SEO;
   - slug;
6. revisar os dados;
7. informar dados que a IA não consiga determinar;
8. salvar a peça;
9. receber automaticamente o próximo SKU válido da categoria.

---

# 3. Princípios arquiteturais

A IA deverá ser utilizada como mecanismo de **interpretação e sugestão**, não como responsável por regras críticas de negócio.

A arquitetura deverá seguir o princípio:

```text
IA sugere
    ↓
Zod valida
    ↓
Backend aplica regras
    ↓
Usuário revisa
    ↓
Backend gera SKU
    ↓
MongoDB persiste
```

A IA NÃO deverá:

- gerar autonomamente o número do SKU;
- acessar diretamente o MongoDB;
- executar queries arbitrárias;
- alterar usuários;
- criar permissões;
- modificar estoque diretamente;
- excluir produtos;
- alterar preços sem confirmação;
- inventar categorias fora da taxonomia permitida.

---

# 4. Stack tecnológica

## 4.1 Front-end

- React
- Vite 8
- TypeScript
- React Router
- Zod
- React Hook Form
- TanStack Query
- CSS Modules ou Tailwind CSS

Preferência inicial:

```text
React
Vite 8
TypeScript
React Router
TanStack Query
React Hook Form
Zod
```

---

# 4.2 Back-end

- Node.js
- TypeScript
- Fastify
- Zod
- MongoDB Driver oficial

Inicialmente não utilizar:

- microserviços;
- Kafka;
- Redis;
- Kubernetes;
- LangChain;
- LangGraph;
- filas distribuídas.

Esses componentes somente deverão ser introduzidos quando existir uma necessidade concreta.

---

# 4.3 Banco de dados

Utilizar:

**MongoDB Atlas**

Collections iniciais:

```text
users
products
categories
sku_sequences
audit_logs
```

Collections futuras:

```text
customers
orders
payments
inventory_movements
marketplace_publications
```

---

# 4.4 Armazenamento de imagens

Utilizar:

**Azure Blob Storage**

Alternativas futuras:

- AWS S3;
- Cloudflare R2.

O MongoDB deverá guardar apenas:

- identificador;
- URL;
- metadados;
- ordem;
- tipo da imagem.

Não armazenar os arquivos binários das fotografias diretamente nos documentos de produtos.

---

# 4.5 Inteligência Artificial

Utilizar um modelo multimodal capaz de receber:

```text
texto
+
uma ou várias imagens
```

e retornar dados estruturados.

A comunicação com o modelo deverá ocorrer exclusivamente pelo backend.

Nunca expor a API Key do provedor de IA no React.

---

# 5. Arquitetura geral

```text
                    USUÁRIO
                       │
                       ▼
             ┌──────────────────┐
             │ React + Vite 8   │
             │                  │
             │ E-commerce       │
             │ Backoffice       │
             └────────┬─────────┘
                      │
                    HTTPS
                      │
                      ▼
             ┌──────────────────┐
             │ Fastify API      │
             │ TypeScript       │
             │                  │
             │ Auth             │
             │ Produtos         │
             │ SKU              │
             │ Usuários         │
             │ IA               │
             └───────┬──────────┘
                     │
          ┌──────────┼──────────────┐
          │          │              │
          ▼          ▼              ▼
     MongoDB       LLM         Azure
      Atlas      Multimodal   Blob Storage
```

---

# 6. Separação entre frontend e backend

Estrutura sugerida:

```text
erp-sample-brecho/
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── layouts/
│   │   ├── pages/
│   │   ├── features/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── schemas/
│   │   └── types/
│   │
│   ├── vite.config.ts
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── modules/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── schemas/
│   │   ├── middleware/
│   │   ├── plugins/
│   │   ├── database/
│   │   └── server.ts
│   │
│   └── package.json
│
└── shared/
    ├── schemas/
    └── types/
```

---

# 7. Domínios iniciais

A aplicação será dividida inicialmente nos seguintes domínios:

```text
Authentication
Users
Products
Categories
SKU
AI Product Intake
Images
Audit
```

---

# 8. Módulos funcionais

## 8.1 Login

Tela de autenticação contendo:

- e-mail;
- senha;
- botão Entrar;
- exibição de erros de autenticação;
- opção futura de recuperação de senha.

Fluxo:

```text
Login
  ↓
POST /auth/login
  ↓
valida usuário
  ↓
valida senha
  ↓
gera sessão
  ↓
cookie seguro
  ↓
dashboard
```

---

# 9. Segurança da autenticação

Senhas nunca deverão ser armazenadas em texto puro.

Utilizar:

**Argon2id**

Exemplo conceitual:

```text
senha
  ↓
Argon2id
  ↓
hash
  ↓
MongoDB
```

A autenticação deverá utilizar:

```text
Access Token
+
Refresh Token
```

Preferencialmente armazenados utilizando cookies:

```text
HttpOnly
Secure
SameSite
```

Evitar armazenar tokens sensíveis em:

```text
localStorage
```

---

# 10. Perfis de acesso

Inicialmente deverão existir três perfis.

## ADMIN

Permissões:

- criar usuários;
- editar usuários;
- desativar usuários;
- alterar perfis;
- cadastrar produtos;
- editar produtos;
- excluir logicamente produtos;
- administrar categorias;
- alterar preços;
- publicar produtos;
- cadastrar, editar, desativar e visualizar contas de marketplace, incluindo suas
  credenciais (multi-loja — seção 81);
- visualizar auditoria.

---

## OPERADOR

Permissões:

- cadastrar produtos;
- utilizar cadastro por IA;
- editar produtos;
- fazer upload de imagens;
- alterar estoque;
- alterar preço;
- publicar produto.

Não poderá:

- criar usuários;
- alterar permissões;
- cadastrar, editar, desativar ou visualizar contas de marketplace ou suas credenciais (só
  publicar usando contas já cadastradas por um ADMIN — seção 81);
- consultar configurações sensíveis.

---

## CONSULTA

Permissões:

- consultar produtos;
- consultar catálogo;
- visualizar estoque.

Não poderá alterar dados.

---

# 11. Modelo de usuário

Collection:

```text
users
```

Documento:

```json
{
  "_id": "ObjectId",

  "name": "Maria Silva",

  "email": "maria@exemplo.com.br",

  "passwordHash": "...",

  "role": "operator",

  "status": "active",

  "lastLoginAt": null,

  "createdAt": "2026-08-20T23:00:00-03:00",

  "updatedAt": "2026-08-20T23:00:00-03:00",

  "createdBy": "ObjectId"
}
```

Valores permitidos para `role`:

```text
admin
operator
viewer
```

Valores permitidos para `status`:

```text
active
inactive
blocked
```

---

# 12. Administração de usuários

Criar módulo:

```text
Administração
    ↓
Usuários
```

Tela:

```text
Usuários
────────────────────────────────────

Buscar usuário...

Nome        E-mail              Perfil      Status

Maria       maria@...           Operador    Ativo
João        joao@...            Admin       Ativo

                        [+ Novo usuário]
```

---

# 13. Criação de usuário

Campos:

- nome;
- e-mail;
- senha temporária;
- confirmação da senha;
- perfil;
- status.

Regras:

- e-mail obrigatório;
- e-mail único;
- senha mínima de 8 caracteres;
- perfil obrigatório;
- usuário criado inicialmente como ativo;
- registrar administrador responsável pela criação.

---

# 14. Gestão de usuários

Administrador deverá poder:

```text
Criar
Visualizar
Editar
Ativar
Desativar
Bloquear
Alterar perfil
Resetar senha
```

Preferencialmente não realizar exclusão física de usuários.

Usar:

```text
status = inactive
```

---

# 15. Modelo de categoria

Collection:

```text
categories
```

Exemplo:

```json
{
  "_id": "ObjectId",

  "code": "BERM",

  "name": "Bermudas",

  "department": "Masculino",

  "active": true,

  "createdAt": "2026-08-20T23:00:00-03:00"
}
```

Exemplos:

```text
BERM | Bermudas
CALC | Calças
CAMI | Camisas
POLO | Camisas Polo
VEST | Vestidos
JAQU | Jaquetas
BLUS | Blusas
SAIA | Saias
SAPT | Sapatos
BOLS | Bolsas
ACES | Acessórios
```

Os códigos deverão ser administrados pelo sistema.

A IA somente poderá selecionar códigos existentes.

---

# 16. Modelo do SKU

Formato:

```text
SPL-{CATEGORIA}-{SEQUENCIA}
```

Exemplo:

```text
SPL-BERM-000001
SPL-BERM-000002
SPL-VEST-000001
SPL-POLO-000001
```

Onde:

```text
SPL     = prefixo da loja (SAMPLE)

BERM    = código da categoria

000001  = sequência numérica da categoria
```

---

# 17. Sequência do SKU

Collection:

```text
sku_sequences
```

Documento:

```json
{
  "_id": "BERM",
  "currentValue": 24
}
```

Para geração do próximo SKU utilizar operação atômica equivalente a:

```javascript
findOneAndUpdate(
  {
    _id: "BERM"
  },
  {
    $inc: {
      currentValue: 1
    }
  },
  {
    upsert: true,
    returnDocument: "after"
  }
)
```

Resultado:

```text
25
```

SKU:

```text
SPL-BERM-000025
```

---

# 18. Regra fundamental do SKU

Nunca implementar:

```text
buscar último SKU
      ↓
somar 1
      ↓
salvar
```

porque duas requisições simultâneas podem gerar o mesmo número.

Usar sempre incremento atômico.

---

# 19. Modelo completo de produto

Collection:

```text
products
```

Estrutura:

```json
{
  "_id": "ObjectId",

  "sku": "SPL-BERM-000025",

  "status": "disponivel",

  "identificacao": {
    "nome": "Bermuda Jeans Stretch Masculina Azul Tamanho 32",
    "descricao": "Bermuda jeans masculina em denim azul...",
    "peca_unica": true,
    "quantidade": 1,
    "data_cadastro": "2026-08-20T23:00:00-03:00"
  },

  "classificacao": {
    "categoria_codigo": "BERM",
    "categoria": "Bermudas",
    "subcategoria": "Bermuda Jeans",
    "departamento": "Masculino",

    "estilo": [
      "Casual",
      "Básico",
      "Urbano"
    ],

    "ocasiao": [
      "Dia a dia",
      "Passeio",
      "Lazer"
    ],

    "estacao": [
      "Primavera",
      "Verão"
    ]
  },

  "marca": {
    "nome": null,
    "original": null
  },

  "caracteristicas": {
    "tamanho_etiqueta": "32",
    "tamanho_equivalente": null,

    "cor_principal": "Azul Jeans",

    "cores_secundarias": [],

    "estampa": "Lisa",

    "material": [
      "Jeans",
      "Denim Stretch"
    ],

    "composicao": null,

    "lavagem": "Média",

    "modelagem": "Reta",

    "elasticidade": "Stretch",

    "fechamento": [
      "Botão",
      "Zíper"
    ]
  },

  "medidas": {
    "unidade": "cm",

    "cintura": null,
    "quadril": null,
    "gancho": null,
    "comprimento": null,
    "largura_barra": null
  },

  "peso": {
    "valor": null,
    "unidade": "kg"
  },

  "condicao": {
    "estado": "novo",

    "nota": 10,

    "possui_etiqueta": true,

    "possui_defeitos": false,

    "defeitos": [],

    "observacoes": "Peça nova com etiquetas."
  },

  "preco": {
    "preco_original_estimado": null,
    "custo_aquisicao": null,
    "preco_venda": null,
    "preco_promocional": null,
    "moeda": "BRL"
  },

  "estoque": {
    "quantidade": 1,

    "localizacao": {
      "loja": "Loja Principal",
      "setor": "Masculino",
      "arara": null,
      "posicao": null
    }
  },

  "imagens": {
    "principal": null,

    "galeria": []
  },

  "ecommerce": {
    "publicado": false,

    "slug": "bermuda-jeans-stretch-masculina-azul-tamanho-32",

    "titulo_seo": "Bermuda Jeans Stretch Masculina Azul Tamanho 32 Nova",

    "tags": [
      "bermuda masculina",
      "bermuda jeans",
      "jeans masculino",
      "bermuda stretch",
      "tamanho 32"
    ]
  },

  "marketplaces": [
    {
      "marketplace": "mercado_livre",
      "conta_id": "ObjectId",
      "conta_apelido": "Loja Demo - Loja 1",
      "status": "publicado",
      "publicado": true,
      "id_anuncio": "MLB123456789",
      "url_anuncio": "https://produto.mercadolivre.com.br/MLB-123456789",
      "publicado_em": "2026-09-18T10:00:00-03:00",
      "erro": null
    },

    {
      "marketplace": "mercado_livre",
      "conta_id": "ObjectId",
      "conta_apelido": "Loja Demo - Loja 2",
      "status": "nao_publicado",
      "publicado": false,
      "id_anuncio": null,
      "url_anuncio": null,
      "publicado_em": null,
      "erro": null
    },

    {
      "marketplace": "shopee",
      "conta_id": "ObjectId",
      "conta_apelido": "Loja Demo - Shopee",
      "status": "nao_publicado",
      "publicado": false,
      "id_anuncio": null,
      "url_anuncio": null,
      "publicado_em": null,
      "erro": null
    }
  ],

  "venda": {
    "vendido": false,

    "data_venda": null,

    "canal_venda": null,

    "valor_venda": null
  },

  "ai_metadata": {
    "generated": true,

    "model": null,

    "generated_at": null,

    "fields": {}
  },

  "auditoria": {
    "criado_por": "ObjectId",

    "criado_em": "2026-08-20T23:00:00-03:00",

    "atualizado_por": "ObjectId",

    "atualizado_em": "2026-08-20T23:00:00-03:00"
  }
}
```

`marketplaces` é uma lista com **zero, uma ou várias publicações por peça** — cada item
representa uma combinação (marketplace + conta), permitindo publicar a mesma peça em mais de
uma conta do mesmo marketplace (ex.: duas lojas diferentes no Mercado Livre). Ver seção 81.

`peso.valor` é sempre em **kg** e deve aceitar **casas decimais** (ex.: `0.350` para uma
peça de 350g) — não deve ser tratado como número inteiro. Assim como as demais medidas
(seção 19), é opcional no cadastro (`null` até ser preenchido).

---

# 20. Status de produtos

Valores permitidos:

```text
rascunho
em_revisao
disponivel
reservado
vendido
inativo
```

Fluxo normal:

```text
rascunho
   ↓
em_revisao
   ↓
disponivel
   ↓
reservado
   ↓
vendido
```

---

# 21. Cadastro tradicional de produto

O usuário deverá poder cadastrar manualmente:

```text
Produtos
   ↓
Novo Produto
   ↓
Cadastro Manual
```

Campos deverão refletir o modelo de produto.

---

# 22. Cadastro assistido por IA

Disponibilizar:

```text
Produtos
   ↓
Novo Produto
   ↓
Cadastrar com IA
```

Interface inicial:

```text
┌────────────────────────────────────┐
│ Cadastrar peça com IA              │
│                                    │
│ Fotos                              │
│                                    │
│ [+ Adicionar imagens]              │
│                                    │
│ Descreva a peça                    │
│                                    │
│ Bermuda jeans masculina nova       │
│ tamanho 32                         │
│                                    │
│         [ Analisar com IA ]        │
└────────────────────────────────────┘
```

---

# 23. Fluxo de IA

```text
Fotos
+
Descrição do operador
       │
       ▼
POST /api/products/analyze
       │
       ▼
Backend
       │
       ▼
LLM multimodal
       │
       ▼
Structured Output
       │
       ▼
Zod
       │
       ▼
Produto em revisão
       │
       ▼
Usuário confirma
       │
       ▼
Gerar SKU
       │
       ▼
Salvar produto
```

---

# 24. Saída da IA

A IA deverá retornar somente atributos da peça.

NÃO deverá retornar SKU definitivo.

Exemplo:

```json
{
  "categoria_codigo": "BERM",

  "identificacao": {
    "nome": "Bermuda Jeans Stretch Masculina Azul Tamanho 32",

    "descricao": "Bermuda jeans masculina..."
  },

  "classificacao": {
    "categoria": "Bermudas",

    "subcategoria": "Bermuda Jeans",

    "departamento": "Masculino"
  },

  "caracteristicas": {
    "tamanho_etiqueta": "32",

    "cor_principal": "Azul Jeans",

    "material": [
      "Jeans",
      "Denim Stretch"
    ]
  },

  "condicao": {
    "estado": "novo",

    "possui_etiqueta": true,

    "possui_defeitos": false
  }
}
```

---

# 25. Informação desconhecida

A IA não deverá inventar informações.

Quando não for possível determinar:

```json
{
  "marca": {
    "nome": null
  }
}
```

e não:

```json
{
  "marca": {
    "nome": "Marca provavelmente XYZ"
  }
}
```

---

# 26. Confiança da IA

Sempre que possível registrar confiança por campo:

```json
{
  "ai_metadata": {
    "fields": {
      "caracteristicas.cor_principal": {
        "confidence": 0.98,
        "source": "image"
      },

      "caracteristicas.tamanho_etiqueta": {
        "confidence": 0.99,
        "source": "image+prompt"
      },

      "marca.nome": {
        "confidence": 0.20,
        "source": "image"
      }
    }
  }
}
```

---

# 27. Human in the Loop

Nenhum produto gerado pela IA deverá ser publicado automaticamente na primeira versão.

Fluxo:

```text
IA
 ↓
preenche ficha
 ↓
operador revisa
 ↓
operador altera se necessário
 ↓
Salvar
```

---

# 28. Uso do Zod

O Zod será responsável por validar o contrato entre:

```text
Frontend
Backend
IA
MongoDB
```

Exemplo:

```typescript
const ProductConditionSchema = z.object({
  estado: z.enum([
    "novo",
    "seminovo",
    "usado"
  ]),

  nota: z.number()
    .min(0)
    .max(10)
    .nullable(),

  possui_etiqueta: z.boolean(),

  possui_defeitos: z.boolean(),

  defeitos: z.array(
    z.object({
      tipo: z.string(),

      descricao: z.string(),

      localizacao: z.string().nullable(),

      foto: z.string().nullable()
    })
  )
});
```

---

# 29. Regras com Zod

Exemplo:

se:

```text
possui_defeitos = true
```

então:

```text
defeitos.length >= 1
```

A regra deverá ser validada antes da persistência.

---

# 30. Administração de produtos

Tela:

```text
Produtos
```

Recursos:

- busca;
- filtros;
- ordenação;
- paginação;
- novo produto;
- edição;
- visualização;
- ativação;
- desativação;
- publicação;
- marcação como vendido.

---

# 31. Filtros de produtos

Permitir filtros por:

```text
SKU
nome
categoria
subcategoria
departamento
marca
tamanho
cor
estado da peça
status
faixa de preço
data de cadastro
```

---

# 32. Tela de produtos

Exemplo:

```text
Produtos

[Buscar pelo nome ou SKU...]

Categoria [Todos]
Status    [Disponível]
Tamanho   [Todos]

-----------------------------------------------------

Foto   SKU                 Produto              Preço

       SPL-BERM-000025     Bermuda Jeans        R$129,90

       SPL-POLO-000018     Polo Masculina       R$89,90

-----------------------------------------------------

                    [+ Novo Produto]
```

---

# 33. Dashboard administrativo

Tela inicial após autenticação.

Indicadores iniciais:

```text
Produtos disponíveis

Produtos cadastrados hoje

Produtos vendidos

Produtos em revisão

Produtos sem preço

Produtos sem imagens
```

Posteriormente:

```text
Faturamento
Ticket médio
Produtos mais visualizados
Categorias mais vendidas
Giro de estoque
Margem
```

---

# 34. Auditoria

Criar collection:

```text
audit_logs
```

Exemplo:

```json
{
  "_id": "ObjectId",

  "userId": "ObjectId",

  "action": "PRODUCT_UPDATE",

  "entity": "product",

  "entityId": "ObjectId",

  "timestamp": "2026-08-20T23:30:00-03:00",

  "metadata": {
    "field": "preco.preco_venda",

    "oldValue": 129.90,

    "newValue": 119.90
  }
}
```

---

# 35. Operações auditáveis

Registrar pelo menos:

```text
LOGIN_SUCCESS
LOGIN_FAILED

USER_CREATE
USER_UPDATE
USER_DISABLE

PRODUCT_CREATE
PRODUCT_UPDATE
PRODUCT_DISABLE
PRODUCT_PUBLISH
PRODUCT_SOLD

PRICE_UPDATE

CATEGORY_CREATE
CATEGORY_UPDATE
CATEGORY_DISABLE

MARKETPLACE_ACCOUNT_CREATE
MARKETPLACE_ACCOUNT_UPDATE
MARKETPLACE_ACCOUNT_DISABLE
MARKETPLACE_ACCOUNT_VIEW
```

`MARKETPLACE_ACCOUNT_VIEW` registra todo acesso à credencial de uma conta de marketplace
(mesmo mascarada), não só criação/alteração — essas credenciais são um alvo sensível e
precisam de rastreabilidade de quem consultou, e quando (seção 81).

---

# 36. Segurança de rotas

As APIs deverão possuir middleware de autenticação.

Exemplo:

```text
request
  ↓
authentication middleware
  ↓
authorization middleware
  ↓
controller
```

---

# 37. Autorização

Exemplo:

```text
DELETE /users/:id
```

deverá exigir:

```text
role = admin
```

Enquanto:

```text
POST /products
```

poderá aceitar:

```text
admin
operator
```

---

# 38. API inicial

Base:

```text
/api
```

---

# 39. Authentication API

```text
POST /api/auth/login

POST /api/auth/logout

POST /api/auth/refresh

GET /api/auth/me
```

---

# 40. Users API

```text
GET    /api/users

GET    /api/users/:id

POST   /api/users

PATCH  /api/users/:id

PATCH  /api/users/:id/status

PATCH  /api/users/:id/password
```

Apenas administradores poderão acessar o módulo.

---

# 41. Products API

```text
GET    /api/products

GET    /api/products/:id

POST   /api/products

PATCH  /api/products/:id

DELETE /api/products/:id
```

`DELETE` deverá preferencialmente realizar exclusão lógica.

---

# 42. AI API

```text
POST /api/products/analyze
```

Entrada:

```text
multipart/form-data
```

Contendo:

```text
prompt
images[]
```

Resposta:

```json
{
  "success": true,

  "data": {
    "...": "produto estruturado"
  }
}
```

Essa operação NÃO deverá gerar SKU.

---

# 43. Confirmação do produto

Endpoint:

```text
POST /api/products/confirm
```

Fluxo:

```text
recebe produto revisado
       ↓
valida Zod
       ↓
valida categoria
       ↓
incrementa sequência
       ↓
gera SKU
       ↓
persiste produto
       ↓
retorna produto
```

---

# 44. Categories API

```text
GET    /api/categories

POST   /api/categories

PATCH  /api/categories/:id

PATCH  /api/categories/:id/status
```

---

# 45. Imagens API

```text
POST   /api/images

DELETE /api/images/:id
```

Upload deverá ser permitido somente para usuários autenticados.

Validar:

- MIME type;
- tamanho;
- número máximo de imagens;
- extensões permitidas.

---

# 46. Requisitos de segurança

Obrigatórios:

- HTTPS;
- senhas Argon2id;
- cookies HttpOnly;
- cookies Secure em produção;
- SameSite;
- proteção contra brute force;
- rate limit;
- validação Zod de toda entrada;
- validação de MIME type;
- limite de tamanho de upload;
- sanitização;
- CORS restritivo;
- secrets exclusivamente em environment variables;
- logs de segurança;
- RBAC;
- MongoDB não acessível diretamente pelo frontend;
- credenciais de integrações de marketplace (API keys, tokens OAuth etc.) criptografadas em
  repouso, nunca em texto puro (seção 81);
- proteção contra spoofing e demais vulnerabilidades específicas de integrações externas com
  marketplaces (seção 81).

---

# 47. Variáveis de ambiente

Backend:

```text
NODE_ENV

PORT

MONGODB_URI

JWT_ACCESS_SECRET

JWT_REFRESH_SECRET

AI_API_KEY

AZURE_STORAGE_CONNECTION_STRING

AZURE_STORAGE_CONTAINER_NAME

FRONTEND_URL
```

Nunca versionar `.env`.

---

# 48. Rate limiting

Aplicar principalmente em:

```text
/auth/login

/products/analyze
```

A chamada de IA deverá possuir limites para evitar custos inesperados.

Exemplo conceitual:

```text
10 análises / minuto / usuário
```

O valor deverá ser configurável.

---

# 49. Projeto gráfico

A identidade visual deverá ser inspirada em um brechó de peças únicas com posicionamento sofisticado,
utilizando como principais referências:

- o site de referência informado no projeto;
- a imagem de identidade visual fornecida;
- estética clássica;
- aparência sofisticada;
- elementos vintage;
- bordô;
- dourado;
- textura semelhante a veludo;
- ornamentos clássicos.

---

# 50. Paleta visual

Paleta inicial sugerida:

```text
Bordô profundo
#4A0008

Bordô principal
#65000B

Bordô claro
#7E101C

Dourado
#B28233

Dourado claro
#D5AD55

Dourado iluminado
#E4C36A

Creme
#F6EFE2

Preto
#15100C

Branco
#FFFFFF
```

A paleta deverá ser ajustada visualmente com base nos assets oficiais.

---

# 51. Identidade visual

O logo deverá ser protagonista principalmente em:

- tela inicial;
- login;
- cabeçalho;
- rodapé;
- e-commerce.

No backoffice utilizar versão reduzida para não comprometer espaço funcional.

---

# 52. Tipografia

Combinar:

### Títulos

Fonte serifada elegante.

Exemplos:

```text
Cormorant Garamond
Playfair Display
Libre Baskerville
```

### Corpo

Fonte de alta legibilidade.

Exemplos:

```text
Inter
Lato
Source Sans
```

Não utilizar fontes excessivamente ornamentadas para textos longos.

---

# 53. Estilo visual

Elementos principais:

```text
Bordô
+
Dourado
+
Creme
+
Ornamentos sutis
+
Sombras
+
Bordas douradas
+
Cards
+
Texturas discretas
```

Evitar excesso de ornamentação dentro do backoffice.

O e-commerce poderá possuir estética mais rica.

O painel administrativo deverá priorizar:

```text
legibilidade
+
rapidez
+
clareza
```

---

# 54. Componentes visuais

Criar componentes reutilizáveis:

```text
Button

Input

Select

Textarea

Modal

Dialog

Card

Badge

Table

Pagination

SearchInput

ImageUploader

ProductCard

ProductForm

UserForm

Sidebar

Header

Breadcrumb

Loading

Toast

ConfirmationDialog
```

---

# 55. Layout do Backoffice

Desktop:

```text
┌────────────────────────────────────────────┐
│ Logo            Usuário              Sair │
├───────────┬────────────────────────────────┤
│           │                                │
│ Dashboard │                                │
│ Produtos  │          Conteúdo              │
│ Categorias│                                │
│ Usuários  │                                │
│           │                                │
│ Config.   │                                │
│           │                                │
└───────────┴────────────────────────────────┘
```

---

# 56. Responsividade

A aplicação deverá suportar:

```text
Desktop
Tablet
Smartphone
```

O cadastro de produto deverá ser especialmente otimizado para smartphone, pois fotografias poderão ser feitas diretamente pelo dispositivo.

---

# 57. Captura de imagens no celular

O frontend deverá aceitar:

```html
<input
  type="file"
  accept="image/*"
  capture="environment"
/>
```

quando suportado pelo navegador.

Fluxo desejado:

```text
Abrir cadastro
      ↓
Fotografar frente
      ↓
Fotografar costas
      ↓
Fotografar etiqueta
      ↓
Informar descrição
      ↓
Analisar com IA
```

---

# 58. Imagens recomendadas

O sistema deverá orientar o usuário a fornecer:

```text
1. Frente
2. Costas
3. Etiqueta
4. Detalhes
5. Defeitos, se existentes
```

---

# 59. Estados de interface

Toda operação remota deverá possuir:

```text
loading

success

error

empty
```

Exemplo durante análise:

```text
Analisando peça...

A IA está avaliando as imagens e
preenchendo as características.
```

---

# 60. Feedback da análise

Depois da IA:

```text
✓ Categoria identificada

✓ Tamanho identificado

✓ Cor identificada

⚠ Marca não identificada

⚠ Composição não identificada
```

Isso facilita a revisão humana.

---

# 61. Índices MongoDB

Criar índice único:

```javascript
{
  sku: 1
}
```

com:

```text
unique = true
```

Criar índice único em usuários:

```javascript
{
  email: 1
}
```

---

# 62. Índices de pesquisa

Inicialmente:

```javascript
{
  "classificacao.categoria_codigo": 1,
  "status": 1
}
```

e:

```javascript
{
  "classificacao.departamento": 1,
  "caracteristicas.tamanho_etiqueta": 1,
  "status": 1
}
```

---

# 63. Requisitos não funcionais

## Performance

Interfaces comuns:

```text
< 2 segundos
```

quando infraestrutura permitir.

Operações de IA poderão possuir tempo maior.

---

## Disponibilidade

Suficiente para operação de pequena empresa.

Não exigir arquitetura multi-região na primeira versão.

---

## Escalabilidade

A arquitetura deverá permitir evolução sem exigir microserviços inicialmente.

---

## Manutenibilidade

Obrigatório:

```text
TypeScript strict
ESLint
Prettier
Zod
componentização
separação de responsabilidades
testes automatizados
```

---

# 64. Estratégia de testes

## Unitários

Testar principalmente:

```text
SKU Generator
Zod schemas
regras de produto
regras de usuário
permissões
```

---

## Integração

Testar:

```text
Fastify + MongoDB

Auth

Products

Users

SKU sequence
```

---

## E2E

Fluxos prioritários:

```text
Login

Cadastrar peça manualmente

Cadastrar peça utilizando IA

Editar peça

Criar usuário

Alterar usuário

Marcar peça como vendida
```

---

# 65. Critério de aceite — Login

DADO um usuário ativo

QUANDO informar e-mail e senha corretos

ENTÃO deverá ser autenticado e levado ao dashboard.

---

# 66. Critério de aceite — Login inválido

DADO um usuário

QUANDO informar credenciais incorretas

ENTÃO:

- não autenticar;
- não revelar se o e-mail existe;
- registrar tentativa;
- apresentar mensagem genérica.

---

# 67. Critério de aceite — Cadastro com IA

DADO um operador autenticado

E fotografias de uma peça

E uma descrição textual

QUANDO clicar em:

```text
Analisar com IA
```

ENTÃO o sistema deverá:

- enviar texto e imagens ao backend;
- solicitar análise ao modelo multimodal;
- validar o resultado;
- preencher o formulário;
- permitir edição;
- não salvar automaticamente.

---

# 68. Critério de aceite — SKU

DADO:

```text
BERM.currentValue = 24
```

QUANDO um novo produto da categoria BERM for confirmado

ENTÃO deverá ser criado:

```text
SPL-BERM-000025
```

e:

```text
BERM.currentValue = 25
```

---

# 69. Critério de aceite — concorrência

DADAS duas requisições simultâneas

QUANDO ambas cadastrarem uma Bermuda

ENTÃO os SKUs deverão ser distintos.

Exemplo:

```text
SPL-BERM-000025

SPL-BERM-000026
```

Nunca poderão existir dois produtos com o mesmo SKU.

---

# 70. Critério de aceite — usuário administrador

DADO um usuário `admin`

QUANDO acessar Administração → Usuários

ENTÃO poderá:

```text
consultar
criar
editar
ativar
desativar
alterar perfil
resetar senha
```

---

# 71. Critério de aceite — operador

DADO um usuário `operator`

QUANDO tentar acessar:

```text
/admin/users
```

ENTÃO deverá receber:

```text
403 Forbidden
```

e a página deverá permanecer inacessível no frontend.

---

# 72. Critério de aceite — dados desconhecidos pela IA

DADO que a marca não seja visível

QUANDO a IA analisar a peça

ENTÃO deverá produzir:

```json
{
  "marca": {
    "nome": null
  }
}
```

Nunca deverá inventar uma marca.

---

# 73. MVP

A primeira versão deverá possuir apenas:

```text
Login

Dashboard

Usuários

Categorias

Produtos

Cadastro Manual

Cadastro por IA

SKU automático

Upload de imagens

Edição de produto

Busca de produtos

Controle de status

Auditoria básica
```

---

# 74. Fora do MVP

Não implementar inicialmente:

```text
Carrinho

Checkout

Gateway de pagamento

Frete automatizado

Mercado Livre

Shopee

eBay

CRM

Programa de fidelidade

Recomendação por IA

Precificação automática

ERP

BI avançado

Multiagentes
```

Esses recursos deverão ser tratados como evolução. Mercado Livre, Shopee e eBay têm essa
evolução detalhada nas seções 79 e 80 (módulo de integração com e-commerce) — continuam fora
do MVP original (specs 001–010), mas já com regras de negócio definidas para implementação
posterior, conector por conector.

---

# 75. Roadmap sugerido

**Reprioridade (v1.3):** venda via marketplaces passou a ser priorizada sobre a construção de
um e-commerce próprio — publicar peças em Mercado Livre/Shopee/eBay entrega canal de venda
mais rápido do que construir catálogo público, carrinho e checkout próprios. As fases de
"E-commerce" e "Venda" (loja própria) permanecem no roadmap, mas foram despriorizadas para
depois de Marketplaces e Inteligência comercial.

## Fase 1 — Backoffice

```text
Autenticação

Usuários

RBAC

Categorias

Produtos

MongoDB
```

---

## Fase 2 — Cadastro inteligente

```text
Upload de imagens

LLM multimodal

Zod

Produto em revisão

SKU automático
```

---

## Fase 3 — Marketplaces

Regras de negócio detalhadas nas seções 79, 80 e 81 — camada de conectores (um adapter por
marketplace), publicação de anúncio a partir da tela do produto, ordem de implementação e
suporte a múltiplas contas por marketplace.

```text
Conector Mercado Livre (publicação de anúncio)

Conector Shopee (publicação de anúncio)

Conector eBay (publicação de anúncio)

Demais conectores (avaliados conforme demanda)

Sincronização de estoque (fase futura, fora do escopo inicial dos conectores)

Pedidos externos (fase futura, fora do escopo inicial dos conectores)
```

---

## Fase 4 — Inteligência comercial

```text
Precificação por IA

Recomendação

Análise de giro

Previsão de venda

SEO automático

BI
```

---

## Fase 5 — E-commerce (loja própria, despriorizada)

```text
Catálogo público

Busca

Filtros

Página do produto

Carrinho
```

---

## Fase 6 — Venda (loja própria, despriorizada)

```text
Checkout

Pagamento

Pedido

Baixa automática da peça
```

---

# 76. Regra arquitetural final

Toda funcionalidade deverá respeitar:

```text
React
   ↓
API Fastify
   ↓
Application Service
   ↓
Domain Rules
   ↓
Repository
   ↓
MongoDB
```

Integrações externas deverão ser abstraídas:

```text
AI Provider

Image Provider

Database Repository
```

permitindo substituir fornecedores posteriormente.

---

# 77. Regra específica para IA

O princípio central da aplicação deverá ser:

> **A IA interpreta; a aplicação decide.**

Portanto:

```text
LLM
 ↓
sugestão estruturada
 ↓
Zod
 ↓
regras de negócio
 ↓
revisão humana
 ↓
persistência
```

e nunca:

```text
LLM
 ↓
acesso irrestrito ao banco
```

---

# 78. Resultado esperado do MVP

Ao final do MVP deverá ser possível entrar no sistema, fotografar uma peça, informar algo como:

```text
Bermuda Jeans Stretch masculina nova tamanho 32
```

e receber automaticamente:

```text
Nome

Descrição

Categoria

Departamento

Características

Cor

Tamanho

Condição

Tags

SEO
```

O operador revisará a ficha e pressionará:

```text
Salvar produto
```

O sistema então deverá:

```text
validar produto
        ↓
obter categoria BERM
        ↓
incrementar sequência atomicamente
        ↓
gerar SPL-BERM-XXXXXX
        ↓
salvar produto
        ↓
registrar auditoria
        ↓
confirmar cadastro
```

Esse fluxo deverá constituir o núcleo funcional inicial do **ERP SAMPLE**.

---

# 79. Módulo de integração com e-commerce (camada de conectores)

## Visão geral

O sistema deverá evoluir para publicar peças cadastradas diretamente em marketplaces
externos, a partir dos dados já existentes no ERP — sem retrabalho de digitação pelo
operador e sem re-fotografar a peça.

Essa integração deverá ser construída como uma **camada de conectores**: uma interface comum
("porta") que todo marketplace implementa, e um adaptador concreto por marketplace, seguindo
o mesmo princípio arquitetural já usado para os demais provedores externos (IA, armazenamento
de imagens — seção 76, "integrações externas deverão ser abstraídas"). Isso permite adicionar
um novo
marketplace um a um, sem alterar os módulos já existentes (Produtos, SKU, Estoque, Preço,
Imagens) — só a implementação concreta daquele conector.

```text
Produto (ERP)
    ↓
Camada de conectores (porta comum)
    ↓                    ↓                    ↓
Conector             Conector             Conector
Mercado Livre        Shopee               eBay
    ↓                    ↓                    ↓
API do                API do               API do
Mercado Livre         Shopee               eBay
```

## Funcionalidade principal

Um botão **"Publicar no [Marketplace]"** deverá existir na tela de edição do produto (a
tela do SKU). Ao clicar:

```text
Operador abre o produto
        ↓
Escolhe o marketplace (ex.: Mercado Livre)
        ↓
Escolhe a conta/loja cadastrada naquele marketplace (seção 81) — pulado
automaticamente se só houver uma conta cadastrada
        ↓
Clica em "Publicar no Mercado Livre"
        ↓
Sistema valida se o produto tem dados mínimos completos
        ↓
Sistema monta o anúncio a partir dos dados do produto (seção 19)
        ↓
Conector autentica com o marketplace usando a credencial da conta escolhida (seção 81)
        ↓
Conector cria o anúncio via API do marketplace
        ↓
Sistema grava id/URL do anúncio e status "publicado" numa nova entrada de
`marketplaces` (marketplace + conta — seção 19)
        ↓
Tela do produto exibe selo "Publicado no Mercado Livre (<conta>)" com link pro anúncio
```

Publicar a mesma peça numa segunda conta do mesmo marketplace repete esse fluxo do início,
escolhendo a outra conta — as duas publicações ficam registradas lado a lado, cada uma com
seu próprio id/URL/status de anúncio (seção 81).

## Dados enviados ao marketplace

A fonte de dados é sempre o modelo de produto já existente (seção 19) — nenhum campo novo é
digitado especificamente para a publicação:

```text
Nome
Descrição
Categoria (mapeada para a taxonomia do marketplace, quando aplicável)
Preço de venda
Condição (novo/seminovo/usado, mapeada para as opções do marketplace)
Características relevantes (marca, tamanho, cor, material)
Fotos da galeria (a foto de capa é usada como imagem principal do anúncio)
```

## Regras de negócio

- Só é possível publicar um produto com dados mínimos completos: nome, categoria, preço de
  venda e ao menos uma foto. Publicar sem isso deverá ser bloqueado, com mensagem clara sobre
  o que falta.
- Publicar um anúncio é sempre uma ação explícita do operador — nunca automática (mesmo
  princípio de *human in the loop* já aplicado ao cadastro por IA, seção 27). Nenhum produto é
  publicado em qualquer marketplace sem essa ação direta.
- Publicar não altera o status do produto no ERP (seção 20) — publicação é uma ação
  complementar, não substitui nem antecipa o fluxo de venda local já existente.
- Falha na publicação (erro do marketplace, credencial expirada, atributo obrigatório
  faltando etc.) nunca deverá ser silenciosa: o status na entrada correspondente de
  `marketplaces` (marketplace + conta) deverá registrar o erro (campo `erro`), visível na
  tela do produto, com opção de tentar de novo. Falha numa conta não afeta publicações já
  feitas ou em andamento em outras contas (seção 81).
- Cada marketplace tem sua própria metodologia de publicação — categorias próprias,
  atributos obrigatórios variáveis, regras específicas de imagem (tamanho, quantidade,
  formato). A camada de conectores existe justamente para isolar essa variação: o restante do
  sistema nunca precisa conhecer os detalhes de nenhum marketplace específico.
- Atualizar um produto já publicado (ex.: mudar o preço) **não deverá** sincronizar
  automaticamente com o marketplace nesta primeira fase — o operador republica manualmente
  quando quiser refletir a mudança. Sincronização automática de atualização é evolução
  futura (Fase 4 — Inteligência comercial, seção 75).
- Uma peça vendida por qualquer canal (loja física ou um dos marketplaces) continua exigindo
  baixa manual do operador no ERP (seção 20, "vendido"). Baixa automática cross-channel
  (pausar/remover o anúncio nas demais publicações ativas — inclusive em outras contas do
  mesmo marketplace — quando a peça vender em um canal) fica fora do escopo desta primeira
  fase — cada peça é única, com SKU único (seção 1), então o risco de venda duplicada existe
  até essa sincronização ser implementada; o operador deverá ser orientado a dar baixa manual
  imediatamente após qualquer venda, o que vale igualmente quando a peça está publicada em
  mais de uma conta do mesmo marketplace (seção 81).

## Fora do escopo desta primeira fase (evolução futura)

```text
Importação de pedidos feitos no marketplace de volta para o ERP

Baixa automática de estoque entre canais (cross-channel)

Sincronização automática de preço/estoque após a publicação inicial

Atualização automática de um anúncio já publicado

Suporte a variações (múltiplos tamanhos/cores por anúncio)

Precificação diferenciada por marketplace
```

Esses itens seguirão o mesmo roadmap por fases (seção 75) e deverão ser detalhados quando
cada conector específico avançar de fase.

---

# 80. Roadmap de conectores de marketplace (ordem de implementação)

A implementação deverá seguir estritamente esta ordem, um conector por vez — nenhum conector
novo deverá ser iniciado especulativamente antes do anterior estar completo e validado:

```text
1. Mercado Livre
2. Shopee
3. eBay
4. Demais marketplaces (ex.: Shein, Amazon, Enjoei, OLX) — avaliados um a um,
   conforme demanda real
```

Cada novo conector deverá:

```text
Implementar a mesma interface comum (porta) dos conectores anteriores

Não exigir nenhuma alteração nos módulos de Produtos, SKU, Estoque, Preço ou Imagens

Documentar sua própria metodologia de publicação (autenticação, taxonomia de
categorias, atributos obrigatórios, regras de imagem) como parte da sua especificação
específica

Ser validado de ponta a ponta (publicação real de pelo menos uma peça de teste) antes
de ser considerado concluído

Suportar múltiplas contas cadastradas desde o início (seção 81) — não é uma evolução
separada por marketplace, é parte da interface comum que todo conector implementa
```

---

# 81. Múltiplas contas por marketplace (multi-loja)

> Extensão desenhada nesta versão (1.4) — **ainda não implementada**. Descreve as regras de
> negócio que o módulo de integração com e-commerce (seção 79) deverá seguir quando o operador
> tiver mais de uma conta cadastrada no mesmo marketplace.

## Motivação

O operador pode ter mais de uma loja cadastrada no mesmo marketplace (por exemplo, duas
contas diferentes no Mercado Livre) e precisa poder publicar a mesma peça em ambas, de forma
independente — sem que isso seja tratado como duplicidade ou erro pelo sistema.

## Cadastro de contas de marketplace

Nova área administrativa (restrita ao perfil ADMIN — seção 10): **"Contas de marketplace"**.
Cada conta cadastrada deverá conter:

```text
Marketplace (mercado_livre | shopee | ebay | ...)

Apelido da loja (nome de exibição escolhido pelo operador, ex.: "Loja Demo - Loja 1")

Credencial de autenticação (conforme o método daquele marketplace, ex.: OAuth)

Status da conexão (conectada / desconectada / erro / expirada)

Ativa (permite desativar sem excluir — mesmo princípio de exclusão lógica já usado
para produtos e usuários)
```

Regras de negócio do cadastro:

- É permitido cadastrar quantas contas o operador precisar, inclusive várias do mesmo
  marketplace.
- Cada conta é independente: falha de credencial numa conta não afeta as demais, nem
  publicações já feitas através delas.
- Desativar uma conta não remove nem pausa anúncios já publicados através dela — eles
  continuam ativos no marketplace. Desativar só impede novas publicações usando essa conta;
  as publicações existentes ficam visíveis normalmente no produto (seção 19), com a conta
  identificada como inativa.
- O apelido da conta é de uso interno do ERP (exibido na escolha de conta e no selo de
  publicação do produto) — não é enviado ao marketplace.

## Segurança das credenciais

> Assim como senhas (seção 9), credenciais de marketplace são um alvo sensível — mas, ao
> contrário de senha, o sistema precisa conseguir recuperar o valor original para autenticar
> com a API do marketplace (seção 79), então a proteção é **criptografia reversível**, não
> hash.

- Toda credencial de conector (API key, client secret, token OAuth/refresh token etc.)
  deverá ser armazenada **criptografada em repouso** no banco de dados — nunca em texto
  puro, nem em backups. A chave de criptografia fica fora do banco (environment variable ou
  serviço de segredo dedicado — mesmo princípio de "secrets exclusivamente em environment
  variables" já exigido na seção 46), nunca junto com o dado criptografado.
- Depois de salva, a credencial completa **nunca é exibida de volta** em nenhuma tela ou
  resposta de API — nem para o ADMIN. A tela de "Contas de marketplace" mostra só um valor
  mascarado (ex.: últimos 4 caracteres) e o status da conexão; para trocar a credencial, o
  ADMIN informa um valor novo, que substitui o anterior (não existe "editar" parcial do valor
  já salvo).
- Credenciais (mascaradas ou não) nunca deverão aparecer em logs de aplicação, logs de erro
  ou mensagens de exceção — falha de autenticação com o marketplace (seção 79) deverá
  registrar o tipo de erro, nunca o valor da credencial usada.
- Proteção contra **spoofing** e vulnerabilidades específicas de integração com serviços
  externos:
  - toda comunicação com a API de cada marketplace deverá usar HTTPS, validando o
    certificado do servidor remoto (sem desabilitar verificação de TLS);
  - respostas/webhooks recebidos de um marketplace deverão ter sua autenticidade validada
    (assinatura, segredo compartilhado ou mecanismo equivalente oferecido por aquele
    marketplace) antes de qualquer dado ser aceito — nunca confiar apenas na origem
    (IP/header) da requisição;
  - endpoints de cadastro/edição/visualização de contas de marketplace deverão ter rate
    limit (mesmo princípio já exigido para login — seção 46), para dificultar tentativas de
    força bruta ou enumeração;
  - cada conector (seção 80) deverá tratar a resposta do marketplace como entrada não
    confiável — validada antes de ser gravada no produto (seção 19), do mesmo jeito que
    qualquer entrada externa já é validada com Zod (seção 46).
- Acesso — criar, editar, desativar e **visualizar** (mesmo mascarada) qualquer conta ou
  credencial de marketplace é restrito ao perfil ADMIN (seção 10); todo acesso é auditável
  (`MARKETPLACE_ACCOUNT_VIEW` e demais eventos — seção 35).

## Modelo de produto — publicações por marketplace + conta

Conforme seção 19, `marketplaces` é uma lista de publicações, uma por combinação
(marketplace + conta). A mesma peça pode ter zero, uma ou várias publicações simultâneas,
inclusive mais de uma no mesmo marketplace, desde que em contas diferentes.

## Regras de negócio da extensão

- Publicar a mesma peça em duas contas do mesmo marketplace é permitido e **não** é tratado
  como duplicidade: cada publicação é independente, com seu próprio `id_anuncio`,
  `url_anuncio`, `status` e `erro` (seção 19).
- Não é permitido publicar a mesma peça duas vezes na **mesma** conta — se já existir uma
  publicação ativa para aquela combinação (marketplace + conta), o botão de publicar passa a
  ser "Ver anúncio" / "Republicar", igual ao comportamento de hoje para um único marketplace.
- Republicar após uma falha (campo `erro` preenchido) afeta só a publicação daquela conta —
  as demais publicações da peça, em outras contas ou marketplaces, não são alteradas.
- A escolha de conta na tela do produto (seção 79) só aparece quando há mais de uma conta
  ativa cadastrada para o marketplace escolhido; com uma conta só, o comportamento é idêntico
  ao já descrito na seção 79 (sem passo extra).

## Fora do escopo desta extensão (evolução futura)

```text
Publicação em lote automática em todas as contas de um marketplace de uma só vez —
o operador escolhe e confirma uma conta por vez, explicitamente

Sincronizar preço/estoque entre contas do mesmo marketplace automaticamente

Transferir ou mesclar publicações entre contas (ex.: mover um anúncio de uma
conta para outra)

Limite de contas por marketplace (nenhum limite é imposto nesta fase)
```
