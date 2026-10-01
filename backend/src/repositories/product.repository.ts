import { ObjectId, type Collection, type Db, type Filter } from "mongodb";
import { ProductSchema, type Product } from "../schemas/product.schema.js";
import type { MarketplaceListing } from "../../../shared/dist/schemas/marketplace.schema.js";

export type ProductDocument = Omit<Product, "id"> & { _id: ObjectId };

export interface ListOptions {
  skip?: number;
  limit?: number;
}

function collection(db: Db): Collection<ProductDocument> {
  return db.collection<ProductDocument>("products");
}

/**
 * Sempre revalida contra `ProductSchema` — não é só o cast de tipo do `ProductDocument` sugere.
 * Documentos gravados antes de um campo existir (`peso`) ou num formato antigo (`marketplaces`
 * como objeto fixo, pré-011) só viram o shape canônico (defaults aplicados, `marketplaces`
 * virando `[]`) aqui. Sem isso, quem usa o repositório diretamente (services, não só rotas)
 * herda o formato cru do Mongo — foi exatamente isso que quebrou `publishListing` em produção
 * (22/09/2026): `product.marketplaces.find is not a function` num produto anterior à spec 011,
 * porque o service chama `.find()` antes de qualquer rota ter a chance de reparsear a resposta.
 */
function toProduct(doc: ProductDocument): Product {
  const { _id, ...rest } = doc;
  return ProductSchema.parse({ id: _id.toHexString(), ...rest });
}

/**
 * `imagens.principal` alterna entre `null` (nenhuma foto ainda) e um objeto (`{id, url, ordem,
 * tipo}`) — achatar essa subseção por campo faz o Mongo recusar `$set` de
 * `"imagens.principal.id"` sempre que o valor atual for `null` ("Cannot create field 'id' in
 * element {principal: null}", achado real testando a reavaliação por IA, 24/09/2026: salvar a
 * primeira foto de uma peça que não tinha nenhuma quebrava com 500). `imagens` já era pra ser
 * tratada como bloco atômico (005/007 — o cliente sempre envia a galeria completa), não campo a
 * campo; as demais subseções não têm esse padrão de campo nullable-ou-objeto, só `imagens`.
 */
const ATOMIC_KEYS = new Set(["imagens"]);

/**
 * Achata um objeto aninhado em pares de dot-notation (`{a: {b: 1}}` → `{"a.b": 1}`) para uso
 * em `$set` — permite ao PATCH atualizar só os campos enviados, sem sobrescrever os irmãos
 * não enviados na mesma subseção. Arrays, `Date` e as chaves em `ATOMIC_KEYS` são tratados como
 * valor-folha (nunca achatados por dentro). Chaves com valor `undefined` são omitidas (nunca
 * tocam o campo).
 */
function flattenToDotNotation(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const isPlainObject =
      value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
    if (isPlainObject && !ATOMIC_KEYS.has(key)) {
      Object.assign(result, flattenToDotNotation(value as Record<string, unknown>, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

export const productRepository = {
  async findById(db: Db, id: string): Promise<Product | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await collection(db).findOne({ _id: new ObjectId(id) });
    return doc ? toProduct(doc) : null;
  },

  async findBySku(db: Db, sku: string): Promise<Product | null> {
    const doc = await collection(db).findOne({ sku });
    return doc ? toProduct(doc) : null;
  },

  async list(db: Db, filter: Filter<ProductDocument>, options: ListOptions = {}): Promise<Product[]> {
    const docs = await collection(db)
      .find(filter)
      .sort({ "identificacao.data_cadastro": -1 })
      .skip(options.skip ?? 0)
      .limit(options.limit ?? 20)
      .toArray();
    return docs.map(toProduct);
  },

  async count(db: Db, filter: Filter<ProductDocument>): Promise<number> {
    return collection(db).countDocuments(filter);
  },

  /** `input` já deve ser o documento completo, validado contra `ProductSchema` (sem `id`). */
  async create(db: Db, input: Omit<Product, "id">): Promise<Product> {
    const doc: ProductDocument = { _id: new ObjectId(), ...input };
    await collection(db).insertOne(doc);
    return toProduct(doc);
  },

  async update(db: Db, id: string, patch: Record<string, unknown>): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const flat = flattenToDotNotation(patch);
    if (Object.keys(flat).length === 0) return;
    await collection(db).updateOne({ _id: new ObjectId(id) }, { $set: flat });
  },

  /** Exclusão lógica (constituição, princípio VIII) — nunca `deleteOne`. */
  async softDelete(db: Db, id: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne({ _id: new ObjectId(id) }, { $set: { status: "inativo" } });
  },

  /**
   * Upsert por combinação (marketplace, conta) — spec 011, seção 4.2: atualiza o item
   * existente (`$` posicional) se já houver uma publicação para essa combinação, ou adiciona
   * um item novo (`$push`) caso contrário. Nunca duplica.
   */
  async upsertMarketplaceListing(db: Db, productId: string, listing: MarketplaceListing): Promise<void> {
    if (!ObjectId.isValid(productId)) return;

    const updateResult = await collection(db).updateOne(
      {
        _id: new ObjectId(productId),
        marketplaces: { $elemMatch: { marketplace: listing.marketplace, conta_id: listing.conta_id } },
      },
      { $set: { "marketplaces.$": listing } },
    );

    if (updateResult.matchedCount === 0) {
      // Pipeline update (não um `$push` simples): documentos no formato antigo (pré-011,
      // `marketplaces` como objeto fixo) fazem o Mongo recusar `$push` com "must be an array but
      // is of type object" — achado real em produção (22/09/2026). `$isArray` trata qualquer valor
      // que não seja array (objeto antigo, ausente, null) como lista vazia antes de adicionar, o
      // mesmo saneamento que `MarketplacesSchema` (shared) já faz na leitura.
      await collection(db).updateOne({ _id: new ObjectId(productId) }, [
        {
          $set: {
            marketplaces: {
              $concatArrays: [{ $cond: [{ $isArray: "$marketplaces" }, "$marketplaces", []] }, [listing]],
            },
          },
        },
      ]);
    }
  },

  /**
   * Quantos anúncios `publicado` cada conta de marketplace tem (spec 011, seção 2.2.2), por `conta_id`.
   * Conta **todos** os produtos, inclusive `vendido`/`inativo` — são justamente os que precisam ter o
   * anúncio encerrado. Um só `aggregate` para todas as contas. Documentos no formato antigo de
   * `marketplaces` (objeto) não casam com o `$match` e são ignorados.
   */
  async countPublishedListingsByAccount(db: Db): Promise<Map<string, number>> {
    const rows = await collection(db)
      .aggregate<{ _id: string; count: number }>([
        { $unwind: "$marketplaces" },
        { $match: { "marketplaces.status": "publicado" } },
        { $group: { _id: "$marketplaces.conta_id", count: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((row) => [row._id, row.count]));
  },
};
