import type { Collection, Db } from "mongodb";

export interface SkuSequenceDocument {
  _id: string;
  currentValue: number;
}

function collection(db: Db): Collection<SkuSequenceDocument> {
  return db.collection<SkuSequenceDocument>("sku_sequences");
}

export const skuSequenceRepository = {
  /**
   * Incremento atômico — `findOneAndUpdate` com `$inc` e `upsert: true`. NUNCA ler
   * `currentValue` antes de somar (constituição, princípio III): duas chamadas simultâneas
   * receberiam o mesmo valor lido e gerariam SKUs colidentes.
   */
  async incrementAndGet(db: Db, categoryCode: string): Promise<number> {
    const result = await collection(db).findOneAndUpdate(
      { _id: categoryCode },
      { $inc: { currentValue: 1 } },
      { upsert: true, returnDocument: "after" },
    );
    if (!result) {
      throw new Error(`Falha ao incrementar sequência de SKU para "${categoryCode}".`);
    }
    return result.currentValue;
  },
};
