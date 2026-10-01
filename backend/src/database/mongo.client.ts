import { MongoClient, type Db } from "mongodb";

const DATABASE_NAME = "openerpsample";

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Conecta ao MongoDB Atlas uma única vez (singleton) e guarda o handle do database. Deve ser
 * chamado no bootstrap do servidor (`server.ts`), antes de qualquer repository usar `getDb()`.
 */
export async function connectMongo(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI não configurada.");
  }

  // ignoreUndefined: sem isso, o driver converte campos `undefined` em BSON `null` na
  // inserção em vez de omitir a chave — quebra a semântica de "campo opcional e ausente"
  // usada em todo o app (ex.: audit_logs.userId quando a ação não pôde ser atribuída a um
  // usuário).
  client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  db = client.db(DATABASE_NAME);
  await ensureIndexes(db);
  return db;
}

/**
 * Índices obrigatórios pela constituição (princípio X: "peça única, SKU único" — mesma regra
 * vale para `users.email`). `createIndex` é idempotente: reexecutar no boot não tem custo se o
 * índice já existir com a mesma definição.
 */
async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("categories").createIndex({ code: 1 }, { unique: true });
  await db.collection("products").createIndex({ sku: 1 }, { unique: true });
  await db
    .collection("products")
    .createIndex({ "classificacao.categoria_codigo": 1, status: 1 });
  await db
    .collection("products")
    .createIndex({ "classificacao.departamento": 1, "caracteristicas.tamanho_etiqueta": 1, status: 1 });
}

/**
 * Retorna o handle do database já conectado. Lança erro se `connectMongo()` ainda não foi
 * chamado — nenhum repository deve tentar conectar por conta própria.
 */
export function getDb(): Db {
  if (!db) {
    throw new Error(
      "MongoDB ainda não conectado — chame connectMongo() no bootstrap do servidor antes de usar getDb().",
    );
  }
  return db;
}

export async function disconnectMongo(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}
