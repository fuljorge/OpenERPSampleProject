import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";

let mongoServer: MongoMemoryServer;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;
let generateNextSku: typeof import("../../src/services/sku.service.js").generateNextSku;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const mongoClientModule = await import("../../src/database/mongo.client.js");
  disconnectMongo = mongoClientModule.disconnectMongo;
  const db = await mongoClientModule.connectMongo();

  await db.collection("categories").insertOne({
    code: "BERM",
    name: "Bermudas",
    department: "Masculino",
    active: true,
    createdAt: new Date(),
  });

  ({ generateNextSku } = await import("../../src/services/sku.service.js"));
}, 60_000);

afterAll(async () => {
  await disconnectMongo();
  await mongoServer.stop();
});

// Critério de aceite "Concorrência" da spec 004 — não pode ser pulado nem simplificado
// (constituição, princípio III). Testa contra um MongoDB real (mongodb-memory-server), não
// um mock, porque a garantia vem da atomicidade real do `findOneAndUpdate`.
describe("Concorrência na geração de SKU", () => {
  it("20 chamadas simultâneas para a mesma categoria geram 20 SKUs distintos e sequenciais", async () => {
    const N = 20;

    const skus = await Promise.all(Array.from({ length: N }, () => generateNextSku("BERM")));

    const uniqueSkus = new Set(skus);
    expect(uniqueSkus.size).toBe(N);

    for (const sku of skus) {
      expect(sku).toMatch(/^ERP-BERM-\d{6}$/);
    }

    const sequences = skus
      .map((sku) => Number(sku.split("-")[2]))
      .sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it("chamadas para categorias diferentes mantêm sequências independentes", async () => {
    const db = (await import("../../src/database/mongo.client.js")).getDb();
    await db.collection("categories").insertOne({
      code: "VEST",
      name: "Vestidos",
      department: "Feminino",
      active: true,
      createdAt: new Date(),
    });

    const [bermSku, vestSku] = await Promise.all([generateNextSku("BERM"), generateNextSku("VEST")]);

    // BERM continua de onde o teste anterior parou (>20) — não acopla ao valor exato, só
    // confirma que a sequência é continuada, não reiniciada. VEST é categoria nova: começa
    // do zero, independente de BERM.
    expect(Number(bermSku.split("-")[2])).toBeGreaterThan(20);
    expect(vestSku).toBe("ERP-VEST-000001");
  });
});

// T003 — spec 004-sku, tasks.md. Ficava bloqueada esperando `products` existir com o índice
// único em `sku` (criado em `mongo.client.ts`/`ensureIndexes`, ver 005) — retomada agora que
// 005 está implementada. Testa a garantia de última instância (índice do banco), não o
// `sku.service` (que nunca gera duplicata sozinho, por construção atômica — ADR/princípio
// III) — simula um insert de baixo nível que contornaria a geração normal.
describe("Unicidade do SKU (índice único de products.sku)", () => {
  it("inserir um segundo produto com o mesmo sku é rejeitado pelo índice único", async () => {
    const db = (await import("../../src/database/mongo.client.js")).getDb();
    const products = db.collection("products");

    await products.insertOne({ _id: new ObjectId(), sku: "ERP-BERM-000001" });

    await expect(products.insertOne({ _id: new ObjectId(), sku: "ERP-BERM-000001" })).rejects.toMatchObject({
      code: 11000,
    });
  });
});
