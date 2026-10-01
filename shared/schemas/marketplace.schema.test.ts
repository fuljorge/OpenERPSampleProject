import { describe, expect, it } from "vitest";
import { MarketplaceListingSchema, MarketplaceListingStatusEnum } from "./marketplace.schema.js";

const baseListing = {
  marketplace: "mercado_livre",
  conta_id: "acc-1",
  conta_apelido: "Loja Demo - Loja 1",
};

describe("MarketplaceListingSchema — encerramento de anúncio (spec 011, seção 4.7)", () => {
  it("aceita o status `encerrado` com `encerrado_em`", () => {
    const parsed = MarketplaceListingSchema.parse({
      ...baseListing,
      status: "encerrado",
      id_anuncio: "MLB123",
      url_anuncio: "https://produto.mercadolivre.com.br/MLB-123",
      publicado_em: "2026-09-01T12:00:00.000Z",
      encerrado_em: "2026-09-10T12:00:00.000Z",
    });

    expect(parsed.status).toBe("encerrado");
    expect(parsed.encerrado_em).toBeInstanceOf(Date);
    expect(parsed.encerrado_em?.toISOString()).toBe("2026-09-10T12:00:00.000Z");
  });

  it("documento gravado antes do encerramento existir (sem `encerrado_em`) continua válido, com null", () => {
    const parsed = MarketplaceListingSchema.parse({
      ...baseListing,
      status: "publicado",
      id_anuncio: "MLB123",
      url_anuncio: "https://produto.mercadolivre.com.br/MLB-123",
      publicado_em: "2026-09-01T12:00:00.000Z",
      erro: null,
    });

    expect(parsed.encerrado_em).toBeNull();
  });

  it("`publicado` com `erro` preenchido é válido (no ar, com pendência)", () => {
    const parsed = MarketplaceListingSchema.parse({
      ...baseListing,
      status: "publicado",
      id_anuncio: "MLB123",
      erro: "Anúncio criado, mas a descrição não foi enviada: texto inválido",
    });

    expect(parsed.status).toBe("publicado");
    expect(parsed.erro).toContain("descrição");
  });

  it("os status conhecidos são exatamente estes quatro", () => {
    expect(MarketplaceListingStatusEnum.options).toEqual(["nao_publicado", "publicado", "erro", "encerrado"]);
  });

  it("status desconhecido é rejeitado", () => {
    expect(() => MarketplaceListingSchema.parse({ ...baseListing, status: "excluido" })).toThrow();
  });
});
