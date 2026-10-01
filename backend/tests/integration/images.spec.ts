import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hashPassword } from "../../src/services/password.service.js";
import { setImageProviderForTesting } from "../../src/services/image.service.js";
import type { ImageProviderPort } from "../../src/plugins/images/image-provider.port.js";

let mongoServer: MongoMemoryServer;
let app: FastifyInstance;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;

const ADMIN = { email: "admin@example.com", password: "senha-admin-123" };
const OPERATOR = { email: "operador@example.com", password: "senha-operador-123" };
const VIEWER = { email: "viewer@example.com", password: "senha-viewer-123" };

let adminCookie: string;
let operatorCookie: string;
let viewerCookie: string;

const fakeProvider: ImageProviderPort = {
  upload: vi.fn().mockResolvedValue({ id: "fake-uuid.jpg", url: "https://blob.test/fake-uuid.jpg" }),
  remove: vi.fn().mockResolvedValue(undefined),
  download: vi.fn().mockResolvedValue({ buffer: Buffer.from("fake-bytes"), mimeType: "image/jpeg" }),
};

async function loginAs(credentials: { email: string; password: string }) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: credentials });
  const accessCookie = response.cookies.find((c) => c.name === "accessToken");
  if (!accessCookie) throw new Error(`Login falhou para ${credentials.email}: ${response.body}`);
  return accessCookie.value;
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

  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });
  await app.ready();

  adminCookie = await loginAs(ADMIN);
  operatorCookie = await loginAs(OPERATOR);
  viewerCookie = await loginAs(VIEWER);
});

afterAll(async () => {
  await app.close();
  await disconnectMongo();
  await mongoServer.stop();
});

describe("POST /api/images", () => {
  it("sem autenticação retorna 401", async () => {
    const response = await app.inject({ method: "POST", url: "/api/images" });
    expect(response.statusCode).toBe(401);
  });

  it("viewer não pode fazer upload (403)", async () => {
    const formData = new FormData();
    formData.append("file", new Blob([Buffer.from("fake-bytes")], { type: "image/jpeg" }), "foto.jpg");

    const response = await app.inject({
      method: "POST",
      url: "/api/images",
      headers: { cookie: `accessToken=${viewerCookie}` },
      payload: formData,
    });
    expect(response.statusCode).toBe(403);
  });

  it("operador faz upload válido e recebe metadado sem o binário", async () => {
    setImageProviderForTesting(fakeProvider);

    const formData = new FormData();
    formData.append("file", new Blob([Buffer.from("fake-bytes")], { type: "image/jpeg" }), "foto.jpg");

    const response = await app.inject({
      method: "POST",
      url: "/api/images",
      headers: { cookie: `accessToken=${operatorCookie}` },
      payload: formData,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: "fake-uuid.jpg", url: "https://blob.test/fake-uuid.jpg" });
    expect(fakeProvider.upload).toHaveBeenCalledWith(expect.any(Buffer), "image/jpeg", "jpg");
  });

  it("rejeita MIME type não permitido (400) antes de chamar o provedor", async () => {
    setImageProviderForTesting(fakeProvider);
    vi.mocked(fakeProvider.upload).mockClear();

    const formData = new FormData();
    formData.append("file", new Blob([Buffer.from("%PDF-fake")], { type: "application/pdf" }), "arquivo.pdf");

    const response = await app.inject({
      method: "POST",
      url: "/api/images",
      headers: { cookie: `accessToken=${adminCookie}` },
      payload: formData,
    });

    expect(response.statusCode).toBe(400);
    expect(fakeProvider.upload).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/images/:id", () => {
  it("sem autenticação retorna 401", async () => {
    const response = await app.inject({ method: "DELETE", url: "/api/images/fake-uuid.jpg" });
    expect(response.statusCode).toBe(401);
  });

  it("admin remove a imagem delegando ao provedor", async () => {
    setImageProviderForTesting(fakeProvider);
    vi.mocked(fakeProvider.remove).mockClear();

    const response = await app.inject({
      method: "DELETE",
      url: "/api/images/fake-uuid.jpg",
      headers: { cookie: `accessToken=${adminCookie}` },
    });

    expect(response.statusCode).toBe(200);
    expect(fakeProvider.remove).toHaveBeenCalledWith("fake-uuid.jpg");
  });
});
