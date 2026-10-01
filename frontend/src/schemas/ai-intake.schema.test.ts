import { describe, expect, it } from "vitest";
import type { AiSuggestedProduct } from "../../../shared/dist/schemas/ai-intake.schema.js";
import { DEFAULT_PRODUCT_FORM_VALUES, type ProductFormValues } from "./product.schema";
import { aiSuggestionToFormValues } from "./ai-intake.schema";

function baseSuggestion(overrides: Partial<AiSuggestedProduct> = {}): AiSuggestedProduct {
  return {
    identificacao: { nome: "Bermuda Jeans", descricao: null },
    classificacao: { categoria_codigo: "BERM", subcategoria: null, estilo: [], ocasiao: [], estacao: [] },
    marca: { nome: null, original: null },
    caracteristicas: {
      tamanho_etiqueta: "32",
      tamanho_equivalente: null,
      genero: null,
      cor_principal: "Azul",
      cores_secundarias: [],
      estampa: null,
      material: [],
      composicao: null,
      lavagem: null,
      modelagem: null,
      elasticidade: null,
      fechamento: [],
    },
    medidas: {
      unidade: "cm",
      cintura: null,
      quadril: null,
      gancho: null,
      comprimento: null,
      largura_barra: null,
      coxa: null,
      entrepasso: null,
      busto: null,
      largura_ombro: null,
      comprimento_manga: null,
    },
    condicao: { estado: "novo", nota: null, possui_etiqueta: null, possui_defeitos: null, defeitos: [], observacoes: null },
    ai_metadata: { fields: {} },
    ...overrides,
  } as AiSuggestedProduct;
}

describe("aiSuggestionToFormValues (spec 006, seção 5 — cadastro; seção 9 — reavaliação, 24/09/2026)", () => {
  it("sem base: campos não cobertos pela IA (preço, estoque, e-commerce, status) ficam nos defaults em branco", () => {
    const result = aiSuggestionToFormValues(baseSuggestion());
    expect(result.preco_venda).toBe(DEFAULT_PRODUCT_FORM_VALUES.preco_venda);
    expect(result.estoque_quantidade).toBe(DEFAULT_PRODUCT_FORM_VALUES.estoque_quantidade);
    expect(result.status).toBe(DEFAULT_PRODUCT_FORM_VALUES.status);
    expect(result.publicado).toBe(DEFAULT_PRODUCT_FORM_VALUES.publicado);
  });

  it("com base customizado (reavaliação em edição): campos não cobertos pela IA preservam os valores de base, nunca voltam ao default", () => {
    const editedFormValues: ProductFormValues = {
      ...DEFAULT_PRODUCT_FORM_VALUES,
      status: "disponivel",
      preco_venda: "129,90",
      estoque_quantidade: 3,
      slug: "bermuda-jeans-azul-32",
      publicado: true,
    };

    const result = aiSuggestionToFormValues(baseSuggestion(), editedFormValues);

    expect(result.status).toBe("disponivel");
    expect(result.preco_venda).toBe("129,90");
    expect(result.estoque_quantidade).toBe(3);
    expect(result.slug).toBe("bermuda-jeans-azul-32");
    expect(result.publicado).toBe(true);
  });

  it("com base customizado: campos que a IA sugere continuam sendo sobrescritos pela sugestão, não pelo base", () => {
    const editedFormValues: ProductFormValues = { ...DEFAULT_PRODUCT_FORM_VALUES, nome: "Nome antigo", cor_principal: "Verde" };

    const result = aiSuggestionToFormValues(baseSuggestion({ identificacao: { nome: "Bermuda revista pela IA", descricao: null } }), editedFormValues);

    expect(result.nome).toBe("Bermuda revista pela IA");
    expect(result.cor_principal).toBe("Azul");
  });
});
