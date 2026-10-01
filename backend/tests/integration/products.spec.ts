import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hashPassword } from "../../src/services/password.service.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };
const OPERATOR = { email: "operador@example.com", password: "senha-operador-123" };
const VIEWER = { email: "viewer@example.com", password: "senha-viewer-123" };

// Logados uma única vez no beforeAll e reaproveitados — /auth/login tem rate limit de
// 10/min (001), e cada `it` re-logando estourava o limite num arquivo com tantos casos.
let adminCookie: string;
let operatorCookie: string;
let viewerCookie: string;

async function loginAs(credentials: { email: string; password: string }) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: credentials,
  });
  const accessCookie = response.cookies.find((c) => c.name === "accessToken");
  if (!accessCookie) throw new Error(`Login falhou para ${credentials.email}: ${response.body}`);
  return accessCookie.value;
}

function minimalProductPayload(overrides: Record<string, unknown> = {}) {
  return {
    identificacao: { nome: "Bermuda Jeans Stretch Masculina Azul Tamanho 32" },
    classificacao: { categoria_codigo: "BERM" },
    condicao: { estado: "novo" },
    ...overrides,
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
      name: "Operador",
      email: OPERATOR.email,
      passwordHash: await hashPassword(OPERATOR.password),
      role: "operator",
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

  await db.collection("categories").insertMany([
    { code: "BERM", name: "Bermudas", department: "Masculino", active: true, createdAt: new Date() },
    { code: "VEST", name: "Vestidos", department: "Feminino", active: true, createdAt: new Date() },
    { code: "JAQU", name: "Jaquetas", department: "Masculino", active: false, createdAt: new Date() },
  ]);

  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });

  adminCookie = await loginAs(ADMIN);
  operatorCookie = await loginAs(OPERATOR);
  viewerCookie = await loginAs(VIEWER);
}, 60_000);

afterAll(async () => {
  await app.close();
  await disconnectMongo();
  await mongoServer.stop();
});

describe("POST /api/products", () => {
  it("viewer recebe 403", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: viewerCookie },
      payload: minimalProductPayload(),
    });
    expect(response.statusCode).toBe(403);
  });

  it("operator cria produto — gera SKU via 004 e persiste", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: operatorCookie },
      payload: minimalProductPayload(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data.sku).toMatch(/^ERP-BERM-\d{6}$/);
    expect(body.data.status).toBe("rascunho");
    expect(body.data.classificacao).toMatchObject({
      categoria_codigo: "BERM",
      categoria: "Bermudas",
      departamento: "Masculino",
    });
    expect(body.data.ecommerce.slug).toBe("bermuda-jeans-stretch-masculina-azul-tamanho-32");
  });

  it("rejeita categoria inexistente/inativa", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: operatorCookie },
      payload: minimalProductPayload({ classificacao: { categoria_codigo: "JAQU" } }),
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejeita possui_defeitos=true sem defeitos descritos", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: operatorCookie },
      payload: minimalProductPayload({
        condicao: { estado: "usado", possui_defeitos: true, defeitos: [] },
      }),
    });
    expect(response.statusCode).toBe(400);
  });

  it("aceita peso em kg com casas decimais e aplica default quando omitido", async () => {
    const comPeso = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: operatorCookie },
      payload: minimalProductPayload({ peso: { valor: 0.35 } }),
    });
    expect(comPeso.statusCode).toBe(201);
    expect(comPeso.json().data.peso).toMatchObject({ valor: 0.35, unidade: "kg" });

    const semPeso = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: operatorCookie },
      payload: minimalProductPayload(),
    });
    expect(semPeso.statusCode).toBe(201);
    expect(semPeso.json().data.peso).toMatchObject({ valor: null, unidade: "kg" });
  });
});

describe("DELETE /api/products/:id (exclusão lógica)", () => {
  it("realiza soft-delete — status=inativo, documento continua existindo", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload(),
    });
    const id = create.json().data.id;

    const response = await app.inject({
      method: "DELETE",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
    });
    expect(response.statusCode).toBe(200);

    const get = await app.inject({
      method: "GET",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.status).toBe("inativo");
  });

  it("operator recebe 403 (DELETE exige admin — correção documentada em tasks.md)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload(),
    });
    const id = create.json().data.id;

    const response = await app.inject({
      method: "DELETE",
      url: `/api/products/${id}`,
      cookies: { accessToken: operatorCookie },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("PATCH /api/products/:id", () => {
  it("alterar preco.preco_venda gera PRICE_UPDATE com oldValue/newValue", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload({ preco: { preco_venda: 129.9 } }),
    });
    const id = create.json().data.id;

    await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { preco: { preco_venda: 119.9 } },
    });

    const auditResponse = await app.inject({
      method: "GET",
      url: "/api/audit-logs?action=PRICE_UPDATE",
      cookies: { accessToken: adminCookie },
    });
    const entry = auditResponse.json().data.items.find((i: { entityId: string }) => i.entityId === id);
    expect(entry?.metadata).toMatchObject({ oldValue: 129.9, newValue: 119.9 });

    // Alteração só de preço não deve gerar um PRODUCT_UPDATE genérico redundante junto.
    const genericAudit = await app.inject({
      method: "GET",
      url: "/api/audit-logs?action=PRODUCT_UPDATE",
      cookies: { accessToken: adminCookie },
    });
    expect(
      genericAudit.json().data.items.some((i: { entityId: string }) => i.entityId === id),
    ).toBe(false);
  });

  it("PATCH parcial não apaga campos irmãos não enviados (dot-notation, não substitui a subseção)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload({
        caracteristicas: { cor_principal: "Azul Jeans", tamanho_etiqueta: "32" },
      }),
    });
    const id = create.json().data.id;

    await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { caracteristicas: { cor_principal: "Azul Escuro" } },
    });

    const get = await app.inject({
      method: "GET",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
    });
    expect(get.json().data.caracteristicas).toMatchObject({
      cor_principal: "Azul Escuro",
      tamanho_etiqueta: "32",
    });
  });

  it("achado real testando reavaliação por IA (24/09/2026): adicionar a primeira foto via PATCH numa peça sem nenhuma antes não quebra (imagens.principal null → objeto)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload(),
    });
    const id = create.json().data.id;
    expect(create.json().data.imagens.principal).toBeNull();

    const foto = { id: "foto-1.jpg", url: "https://blob.test/foto-1.jpg", ordem: 0, tipo: null };
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { imagens: { principal: foto, galeria: [foto] } },
    });

    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.imagens.principal).toMatchObject({ id: "foto-1.jpg" });
    expect(patch.json().data.imagens.galeria).toHaveLength(1);
  });

  it("altera peso.valor via PATCH, mantendo casas decimais", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload(),
    });
    const id = create.json().data.id;

    await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { peso: { valor: 0.5 } },
    });

    const get = await app.inject({
      method: "GET",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
    });
    expect(get.json().data.peso).toMatchObject({ valor: 0.5, unidade: "kg" });
  });

  it("transição de status inválida é rejeitada (vendido direto de rascunho)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload(),
    });
    const id = create.json().data.id;

    const response = await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { status: "vendido" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("marcar como vendido seta venda.vendido e gera PRODUCT_SOLD", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload(),
    });
    const id = create.json().data.id;

    await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { status: "em_revisao" },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { status: "disponivel" },
    });
    const soldResponse = await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      cookies: { accessToken: adminCookie },
      payload: { status: "vendido", venda: { valor_venda: 129.9, canal_venda: "loja_fisica" } },
    });

    expect(soldResponse.statusCode).toBe(200);
    const body = soldResponse.json();
    expect(body.data.venda).toMatchObject({ vendido: true, valor_venda: 129.9 });

    const auditResponse = await app.inject({
      method: "GET",
      url: "/api/audit-logs?action=PRODUCT_SOLD",
      cookies: { accessToken: adminCookie },
    });
    expect(auditResponse.json().data.items.some((i: { entityId: string }) => i.entityId === id)).toBe(
      true,
    );
  });
});

describe("GET /api/products — filtros combinados", () => {
  it("categoria+status+tamanho retornam só o resultado esperado", async () => {
    // Tamanho exclusivo deste teste — evita colidir com produtos criados por outros `it`
    // deste arquivo (o banco acumula entre eles, mesmo `beforeAll`/`app`), já que a asserção
    // abaixo depende de saber exatamente quais produtos o filtro deveria (não deveria) pegar.
    const TAMANHO_EXCLUSIVO = "32-filtro-teste";

    const wrongSize = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload({
        classificacao: { categoria_codigo: "BERM" },
        caracteristicas: { tamanho_etiqueta: "40" },
      }),
    });
    const target = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload({
        classificacao: { categoria_codigo: "BERM" },
        caracteristicas: { tamanho_etiqueta: TAMANHO_EXCLUSIVO },
      }),
    });
    const wrongCategory = await app.inject({
      method: "POST",
      url: "/api/products",
      cookies: { accessToken: adminCookie },
      payload: minimalProductPayload({
        identificacao: { nome: "Vestido Floral Longo" },
        classificacao: { categoria_codigo: "VEST" },
        caracteristicas: { tamanho_etiqueta: TAMANHO_EXCLUSIVO },
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/products?categoria_codigo=BERM&status=rascunho&tamanho=${TAMANHO_EXCLUSIVO}`,
      cookies: { accessToken: adminCookie },
    });

    const ids = response.json().data.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(target.json().data.id);
    expect(ids).not.toContain(wrongSize.json().data.id);
    expect(ids).not.toContain(wrongCategory.json().data.id);
  });

  it("busca por SKU ou nome (search) funciona", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/products?search=Vestido Floral",
      cookies: { accessToken: adminCookie },
    });
    expect(response.json().data.items.length).toBeGreaterThanOrEqual(1);
  });

  it("sem sessão recebe 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/products" });
    expect(response.statusCode).toBe(401);
  });
});
