import { describe, expect, it } from "vitest";
import { AiSuggestedProductSchema } from "./ai-intake.schema.js";

function baseSuggestion() {
  return {
    identificacao: { nome: "Bermuda Jeans", descricao: null },
    classificacao: { categoria_codigo: "BERM", subcategoria: null, estilo: [], ocasiao: [], estacao: [] },
    marca: { nome: null, original: null },
    caracteristicas: {
      tamanho_etiqueta: null,
      tamanho_equivalente: null,
      genero: null,
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
    condicao: {
      estado: "novo",
      nota: null,
      possui_etiqueta: null,
      possui_defeitos: null,
      defeitos: [],
      observacoes: null,
    },
  };
}

describe("AiSuggestedProductSchema", () => {
  it("aceita uma sugestão válida, com ai_metadata default quando omitido", () => {
    const parsed = AiSuggestedProductSchema.parse(baseSuggestion());
    expect(parsed.ai_metadata).toEqual({ fields: {} });
  });

  it("rejeita campos fora do contrato (sku/preco/status) — .strict(), nunca descarta em silêncio", () => {
    const withInjection = { ...baseSuggestion(), sku: "ERP-BERM-000001", preco: { preco_venda: 1 }, status: "disponivel" };
    expect(AiSuggestedProductSchema.safeParse(withInjection).success).toBe(false);
  });

  it("campos não determináveis chegam como null, nunca omitidos", () => {
    const parsed = AiSuggestedProductSchema.parse(baseSuggestion());
    expect(parsed.marca.nome).toBeNull();
    expect(parsed.condicao.possui_defeitos).toBeNull();
  });

  it("rejeita quando uma subseção obrigatória está ausente", () => {
    const { marca: _marca, ...withoutMarca } = baseSuggestion();
    expect(AiSuggestedProductSchema.safeParse(withoutMarca).success).toBe(false);
  });

  it("aceita um dos 5 valores fechados de genero (spec 005; T060, 23/09/2026)", () => {
    const suggestion = baseSuggestion();
    suggestion.caracteristicas.genero = "feminino";
    expect(AiSuggestedProductSchema.parse(suggestion).caracteristicas.genero).toBe("feminino");
  });

  it("rejeita um valor de genero fora do enum fechado — nunca inventa um sinônimo", () => {
    const suggestion = baseSuggestion();
    suggestion.caracteristicas.genero = "Unissexo";
    expect(AiSuggestedProductSchema.safeParse(suggestion).success).toBe(false);
  });

  it("aceita busto numérico e null (não determinável)", () => {
    const suggestion = baseSuggestion();
    suggestion.medidas.busto = 92;
    expect(AiSuggestedProductSchema.parse(suggestion).medidas.busto).toBe(92);
  });
});
