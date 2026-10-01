import { describe, expect, it } from "vitest";
import { MAX_PRODUCT_IMAGES, ProductSchema } from "./product.schema.js";

function baseProduct() {
  return {
    id: "prod-1",
    sku: "ERP-BERM-000001",
    status: "rascunho",
    identificacao: {
      nome: "Bermuda Jeans Stretch Masculina Azul Tamanho 32",
      data_cadastro: new Date().toISOString(),
    },
    classificacao: {
      categoria_codigo: "BERM",
      categoria: "Bermudas",
      departamento: "Masculino",
    },
    marca: {},
    caracteristicas: {},
    medidas: {},
    peso: {},
    condicao: { estado: "novo" },
    preco: {},
    estoque: {},
    imagens: {},
    ecommerce: {},
    marketplaces: [],
    venda: {},
    ai_metadata: {},
    auditoria: {
      criado_por: "user-1",
      criado_em: new Date().toISOString(),
      atualizado_por: "user-1",
      atualizado_em: new Date().toISOString(),
    },
  };
}

describe("ProductSchema", () => {
  it("aceita um produto válido com o mínimo de campos obrigatórios", () => {
    const result = ProductSchema.safeParse(baseProduct());
    expect(result.success).toBe(true);
  });

  it("aplica defaults sensatos para os campos omitidos", () => {
    const parsed = ProductSchema.parse(baseProduct());
    expect(parsed.identificacao.peca_unica).toBe(true);
    expect(parsed.identificacao.quantidade).toBe(1);
    expect(parsed.marca.nome).toBeNull();
    expect(parsed.preco.moeda).toBe("BRL");
    expect(parsed.ecommerce.publicado).toBe(false);
    expect(parsed.venda.vendido).toBe(false);
    expect(parsed.peso.valor).toBeNull();
    expect(parsed.peso.unidade).toBe("kg");
  });

  it("aceita peso com casas decimais, sempre em kg", () => {
    const product = baseProduct();
    product.peso = { valor: 0.35, unidade: "kg" };

    const parsed = ProductSchema.parse(product);
    expect(parsed.peso.valor).toBe(0.35);
  });

  it("aceita documento persistido antes de `peso` existir (chave ausente, não só valor null)", () => {
    const product = baseProduct() as Record<string, unknown>;
    delete product.peso;

    const parsed = ProductSchema.parse(product);
    expect(parsed.peso).toEqual({ valor: null, unidade: "kg" });
  });

  it("genero é null por padrão (produto persistido antes do campo existir, ou nunca informado)", () => {
    const parsed = ProductSchema.parse(baseProduct());
    expect(parsed.caracteristicas.genero).toBeNull();
  });

  it("aceita um dos 5 valores fechados de genero", () => {
    const product = baseProduct();
    product.caracteristicas = { genero: "feminino" };

    const parsed = ProductSchema.parse(product);
    expect(parsed.caracteristicas.genero).toBe("feminino");
  });

  it("rejeita um valor de genero fora do enum fechado (nunca inventa um sinônimo)", () => {
    const product = baseProduct();
    product.caracteristicas = { genero: "Unissexo" };

    expect(ProductSchema.safeParse(product).success).toBe(false);
  });

  it("rejeita possui_defeitos=true com defeitos=[] (regra condicional da spec)", () => {
    const product = baseProduct();
    product.condicao = { estado: "usado", possui_defeitos: true, defeitos: [] };

    const result = ProductSchema.safeParse(product);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "condicao.defeitos")).toBe(
        true,
      );
    }
  });

  it("aceita possui_defeitos=true quando defeitos tem ao menos um item", () => {
    const product = baseProduct();
    product.condicao = {
      estado: "usado",
      possui_defeitos: true,
      defeitos: ["Mancha pequena na barra"],
    };

    expect(ProductSchema.safeParse(product).success).toBe(true);
  });

  it("campos que a IA não determinou chegam como null, não undefined implícito", () => {
    const product = baseProduct();
    product.marca = { nome: null, original: null };
    product.caracteristicas = { tamanho_etiqueta: "32", cor_principal: null };

    const parsed = ProductSchema.parse(product);
    expect(parsed.marca.nome).toBeNull();
    expect(parsed.caracteristicas.cor_principal).toBeNull();
    expect(parsed.caracteristicas.tamanho_etiqueta).toBe("32");
  });

  it("aceita documento persistido no formato antigo de marketplaces (objeto, não array — spec 011)", () => {
    const product = baseProduct() as Record<string, unknown>;
    product.marketplaces = {
      mercado_livre: { publicado: false, id_anuncio: null },
      shopee: { publicado: false, id_anuncio: null },
    };

    const parsed = ProductSchema.parse(product);
    expect(parsed.marketplaces).toEqual([]);
  });

  it("rejeita produto sem nome (identificação incompleta)", () => {
    const product = baseProduct();
    // @ts-expect-error -- teste de campo obrigatório ausente
    delete product.identificacao.nome;

    expect(ProductSchema.safeParse(product).success).toBe(false);
  });

  it("rejeita produto sem categoria (necessária para gerar SKU)", () => {
    const product = baseProduct();
    // @ts-expect-error -- teste de campo obrigatório ausente
    delete product.classificacao.categoria_codigo;

    expect(ProductSchema.safeParse(product).success).toBe(false);
  });

  it("aceita fotos até o limite e rejeita além de MAX_PRODUCT_IMAGES", () => {
    const foto = (i: number) => ({ id: `img-${i}`, url: `https://blob/img-${i}.jpg` });
    const product = baseProduct();

    product.imagens = { galeria: Array.from({ length: MAX_PRODUCT_IMAGES }, (_, i) => foto(i)) };
    expect(ProductSchema.safeParse(product).success).toBe(true);

    product.imagens = { galeria: Array.from({ length: MAX_PRODUCT_IMAGES + 1 }, (_, i) => foto(i)) };
    expect(ProductSchema.safeParse(product).success).toBe(false);
  });
});
