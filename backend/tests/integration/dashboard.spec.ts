import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import { hashPassword } from "../../src/services/password.service.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };
const VIEWER = { email: "viewer@example.com", password: "senha-viewer-123" };

let adminCookie: string;
let viewerCookie: string;
let expectedSummary: {
  disponiveis: number;
  cadastradosHoje: number;
  vendidos: number;
  emRevisao: number;
  semPreco: number;
  semImagens: number;
};

async function loginAs(credentials: { email: string; password: string }) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: credentials });
  const accessCookie = response.cookies.find((c) => c.name === "accessToken");
  if (!accessCookie) throw new Error(`Login falhou para ${credentials.email}: ${response.body}`);
  return accessCookie.value;
}

interface FixtureSpec {
  status: "disponivel" | "vendido" | "em_revisao" | "inativo";
  dataCadastro: Date;
  temPreco: boolean;
  temImagem: boolean;
}

/** Documento completo e válido contra `ProductSchema` — inserido direto na collection (sem
 * passar pelo `product.service`) para poder controlar `data_cadastro` livremente (a API nunca
 * aceita essa data do cliente, é sempre `now()` no momento da criação). */
function productDoc(spec: FixtureSpec) {
  return {
    _id: new ObjectId(),
    sku: `ERP-TEST-${new ObjectId().toHexString().slice(-6)}`,
    status: spec.status,
    identificacao: {
      nome: "Produto de teste",
      descricao: null,
      peca_unica: true,
      quantidade: 1,
      data_cadastro: spec.dataCadastro,
    },
    classificacao: {
      categoria_codigo: "TEST",
      categoria: "Teste",
      subcategoria: null,
      departamento: "Unissex",
      estilo: [],
      ocasiao: [],
      estacao: [],
    },
    marca: { nome: null, original: null },
    caracteristicas: {
      tamanho_etiqueta: null,
      tamanho_equivalente: null,
      cor_principal: null,
      cores_secundarias: [],
      estampa: null,
      material: [],
      composicao: null,
      lavagem: null,
      modelagem: null,
      elasticidade: null,
      fechamento: [],
    },
    medidas: { unidade: "cm", cintura: null, quadril: null, gancho: null, comprimento: null, largura_barra: null },
    peso: { valor: null, unidade: "kg" },
    condicao: {
      estado: "novo",
      nota: null,
      possui_etiqueta: false,
      possui_defeitos: false,
      defeitos: [],
      observacoes: null,
    },
    preco: {
      preco_original_estimado: null,
      custo_aquisicao: null,
      preco_venda: spec.temPreco ? 100 : null,
      preco_promocional: null,
      moeda: "BRL",
    },
    estoque: { quantidade: 1, localizacao: { loja: "Loja Principal", setor: null, arara: null, posicao: null } },
    imagens: spec.temImagem
      ? { principal: { id: "img1", url: "https://example.com/1.jpg", ordem: 0, tipo: null }, galeria: [] }
      : { principal: null, galeria: [] },
    ecommerce: { publicado: false, slug: "produto-de-teste", titulo_seo: null, tags: [] },
    marketplaces: [],
    venda: { vendido: false, data_venda: null, canal_venda: null, valor_venda: null },
    ai_metadata: { generated: false, model: null, generated_at: null, fields: {} },
    auditoria: {
      criado_por: "tester",
      criado_em: spec.dataCadastro,
      atualizado_por: "tester",
      atualizado_em: spec.dataCadastro,
    },
  };
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const mongoClientModule = await import("../../src/database/mongo.client.js");
  disconnectMongo = mongoClientModule.disconnectMongo;
  const db = await mongoClientModule.connectMongo();

  await db.collection("users").insertMany([
    {
      name: "Administradora",
      email: ADMIN.email,
      passwordHash: await hashPassword(ADMIN.password),
      role: "admin",
      status: "active",
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    },
    {
      name: "Consulta",
      email: VIEWER.email,
      passwordHash: await hashPassword(VIEWER.password),
      role: "viewer",
      status: "active",
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    },
  ]);

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const fixtures: FixtureSpec[] = [
    // P1: disponível/ontem/com preço/com imagem — só conta em "disponíveis".
    { status: "disponivel", dataCadastro: yesterday, temPreco: true, temImagem: true },
    // P2: disponível/ontem/sem preço/sem imagem — "disponíveis" + "sem preço" + "sem imagens".
    { status: "disponivel", dataCadastro: yesterday, temPreco: false, temImagem: false },
    // P3: vendida/hoje — "vendidos" + "cadastrados hoje".
    { status: "vendido", dataCadastro: today, temPreco: true, temImagem: true },
    // P4: em revisão/ontem/sem preço/sem imagem — "em revisão" + "sem preço" + "sem imagens".
    { status: "em_revisao", dataCadastro: yesterday, temPreco: false, temImagem: false },
    // P5: inativa/sem preço/sem imagem — NÃO deve contar em "sem preço"/"sem imagens".
    { status: "inativo", dataCadastro: yesterday, temPreco: false, temImagem: false },
    // P6: disponível/hoje/sem preço/com imagem — "disponíveis" + "cadastrados hoje" + "sem preço".
    { status: "disponivel", dataCadastro: today, temPreco: false, temImagem: true },
    // P7: disponível/ontem/sem preço/com imagem — só conta em "sem preço".
    { status: "disponivel", dataCadastro: yesterday, temPreco: false, temImagem: true },
    // P8: disponível/ontem/com preço/sem imagem — só conta em "sem imagens".
    { status: "disponivel", dataCadastro: yesterday, temPreco: true, temImagem: false },
  ];

  await db.collection("products").insertMany(fixtures.map(productDoc));

  // Contagens esperadas derivadas das mesmas specs acima (em vez de calculadas à mão) — evita
  // erro de aritmética manual em uma fixture com várias combinações.
  expectedSummary = {
    disponiveis: fixtures.filter((f) => f.status === "disponivel").length,
    cadastradosHoje: fixtures.filter((f) => f.dataCadastro === today).length,
    vendidos: fixtures.filter((f) => f.status === "vendido").length,
    emRevisao: fixtures.filter((f) => f.status === "em_revisao").length,
    semPreco: fixtures.filter((f) => !f.temPreco && f.status !== "inativo").length,
    semImagens: fixtures.filter((f) => !f.temImagem && f.status !== "inativo").length,
  };

  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });
  await app.ready();

  adminCookie = await loginAs(ADMIN);
  viewerCookie = await loginAs(VIEWER);
});

afterAll(async () => {
  await app.close();
  await disconnectMongo();
  await mongoServer.stop();
});

describe("GET /api/dashboard/summary", () => {
  it("sem autenticação retorna 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/dashboard/summary" });
    expect(response.statusCode).toBe(401);
  });

  it("viewer também pode consultar (nenhuma role adicional exigida)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard/summary",
      headers: { cookie: `accessToken=${viewerCookie}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it("retorna os 6 indicadores com os valores corretos", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard/summary",
      headers: { cookie: `accessToken=${adminCookie}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(expectedSummary);
  });
});
