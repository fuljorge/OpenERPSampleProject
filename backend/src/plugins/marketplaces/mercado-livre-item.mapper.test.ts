import { describe, expect, it } from "vitest";
import type { Product } from "../../schemas/product.schema.js";
import type { CategoryAttribute, SizeChartRow, TechnicalSpecAttribute } from "./mercado-livre-api.client.js";
import {
  MercadoLivreMappingError,
  PriceOutOfRangeError,
  assertPriceInRange,
  brandAttribute,
  buildChartName,
  buildChartPayload,
  buildChartRowPayload,
  buildCreatePayload,
  buildPictureUrls,
  buildUpdatePayload,
  colorAttributes,
  extraAttributeCandidates,
  garmentMeasureAttributes,
  garmentMeasureFieldName,
  genderAttribute,
  gtinAttribute,
  immediateTag,
  isKnownGarmentMeasureAttribute,
  mapCondition,
  materialAttributes,
  modelAttribute,
  plainSizeAttribute,
  normalizeFootwearSize,
  packageAttributes,
  pendingRequiredAttributes,
  pickAttributes,
  availableSizeLabels,
  pickChartRow,
  resolveFiltrableSizeValue,
  sanitizePlainText,
  sizeChartAttributes,
  skuAttribute,
  topLevelCondition,
  truncateName,
  warrantyTerms,
} from "./mercado-livre-item.mapper.js";

function attr(overrides: Partial<CategoryAttribute> = {}): CategoryAttribute {
  return {
    id: "SOME_ATTR",
    name: "Some attr",
    valueType: "string",
    tags: {
      required: false,
      newRequired: false,
      conditionalRequired: false,
      readOnly: false,
      fixed: false,
      inferred: false,
      hidden: false,
      multivalued: false,
      gridFilter: false,
      gridTemplateRequired: false,
    },
    values: [],
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    sku: "ERP-BERM-000001",
    status: "disponivel",
    identificacao: { nome: "Bermuda Jeans", descricao: null, peca_unica: true, quantidade: 1, data_cadastro: new Date() },
    classificacao: {
      categoria_codigo: "BERM",
      categoria: "Bermudas",
      subcategoria: null,
      departamento: "Masculino",
      estilo: [],
      ocasiao: [],
      estacao: [],
    },
    marca: { nome: null, original: null },
    caracteristicas: {
      tamanho_etiqueta: "42",
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
    medidas: { unidade: "cm", cintura: 80, quadril: 100, gancho: 25, comprimento: 45, largura_barra: null, coxa: 60, entrepasso: 70, busto: null, largura_ombro: null, comprimento_manga: null },
    peso: { valor: 0.3, unidade: "kg" },
    condicao: { estado: "usado", nota: null, possui_etiqueta: false, possui_defeitos: false, defeitos: [], observacoes: null },
    preco: { preco_original_estimado: null, custo_aquisicao: null, preco_venda: 89.9, preco_promocional: null, moeda: "BRL" },
    estoque: { quantidade: 1, localizacao: { loja: "Loja Principal", setor: null, arara: null, posicao: null } },
    imagens: {
      principal: { id: "img1", url: "https://x/1.jpg", ordem: 0, tipo: null },
      galeria: [
        { id: "img1", url: "https://x/1.jpg", ordem: 0, tipo: null },
        { id: "img2", url: "https://x/2.jpg", ordem: 1, tipo: null },
      ],
    },
    ecommerce: { publicado: false, slug: "bermuda-jeans", titulo_seo: null, tags: [] },
    marketplaces: [],
    venda: { vendido: false, data_venda: null, canal_venda: null, valor_venda: null },
    ai_metadata: { generated: false, model: null, generated_at: null, fields: {} },
    auditoria: { criado_por: "user-1", criado_em: new Date(), atualizado_por: "user-1", atualizado_em: new Date() },
    ...overrides,
  };
}

describe("mapCondition (spec 012, seção 3)", () => {
  const itemCondition = attr({
    id: "ITEM_CONDITION",
    values: [
      { id: "2230284", name: "Novo" },
      { id: "2230581", name: "Usado" },
    ],
  });

  it("novo → Novo", () => {
    expect(mapCondition("novo", itemCondition)).toEqual({ id: "ITEM_CONDITION", value_id: "2230284", value_name: "Novo" });
  });

  it.each(["seminovo", "usado"] as const)("%s → Usado (Mercado Livre não distingue seminovo)", (estado) => {
    expect(mapCondition(estado, itemCondition)).toEqual({ id: "ITEM_CONDITION", value_id: "2230581", value_name: "Usado" });
  });

  it("nunca mapeia para Recondicionado", () => {
    const result = mapCondition("usado", itemCondition);
    expect(result.value_name).not.toBe("Recondicionado");
  });

  it("categoria sem ITEM_CONDITION: erro claro", () => {
    expect(() => mapCondition("novo", undefined)).toThrow(MercadoLivreMappingError);
  });

  it("categoria sem o valor correspondente: erro claro", () => {
    expect(() => mapCondition("novo", attr({ id: "ITEM_CONDITION", values: [{ id: "1", name: "Usado" }] }))).toThrow(
      /não aceita a condição "Novo"/,
    );
  });
});

describe("topLevelCondition (spec 012, achado real 24/09/2026)", () => {
  it("novo → \"new\"", () => {
    expect(topLevelCondition("novo")).toBe("new");
  });

  it.each(["seminovo", "usado"] as const)("%s → \"used\"", (estado) => {
    expect(topLevelCondition(estado)).toBe("used");
  });
});

describe("pickAttributes (spec 012, seção 4)", () => {
  it("mantém só o que a categoria aceita", () => {
    const candidates = [{ id: "BRAND", value_name: "Marca X" }, { id: "UNKNOWN_ATTR", value_name: "y" }];
    const categoryAttrs = [attr({ id: "BRAND" })];
    expect(pickAttributes(candidates, categoryAttrs)).toEqual([{ id: "BRAND", value_name: "Marca X" }]);
  });

  it.each(["readOnly", "fixed", "inferred"] as const)("descarta atributo %s", (tag) => {
    const candidates = [{ id: "X", value_name: "y" }];
    const categoryAttrs = [attr({ id: "X", tags: { ...attr().tags, [tag]: true } })];
    expect(pickAttributes(candidates, categoryAttrs)).toEqual([]);
  });

  it("lista fechada (value_type list) sem value_id sai — nunca derruba o anúncio (ADR-035, achado real MAIN_COLOR 'azul claro')", () => {
    const categoryAttrs = [attr({ id: "MAIN_COLOR", valueType: "list" }), attr({ id: "COLOR", valueType: "string" })];
    const candidates = [
      { id: "MAIN_COLOR", value_name: "azul claro" },
      { id: "COLOR", value_name: "azul claro" },
    ];
    expect(pickAttributes(candidates, categoryAttrs)).toEqual([{ id: "COLOR", value_name: "azul claro" }]);
  });

  it("lista fechada com value_id fica", () => {
    const categoryAttrs = [attr({ id: "MAIN_COLOR", valueType: "list" })];
    expect(pickAttributes([{ id: "MAIN_COLOR", value_id: "2450293", value_name: "Azul" }], categoryAttrs)).toHaveLength(1);
  });
});

describe("pendingRequiredAttributes / extraAttributeCandidates (ADR-035 — caixas de seleção na revisão)", () => {
  const required = { ...attr().tags, required: true };
  const garmentType = attr({
    id: "GARMENT_TYPE",
    name: "Tipo de roupa",
    valueType: "list",
    tags: required,
    values: [
      { id: "G1", name: "Jaqueta" },
      { id: "G2", name: "Blazer" },
    ],
  });
  const brand = attr({ id: "BRAND", name: "Marca", valueType: "string", tags: required });
  const size = attr({ id: "SIZE", name: "Tamanho", valueType: "string", tags: required });
  const produto = (subcategoria: string | null) => ({ classificacao: { ...makeProduct().classificacao, subcategoria } });

  it("lista só obrigatório que nenhum candidato cobre, com as opções da categoria", () => {
    const pending = pendingRequiredAttributes([{ id: "BRAND", value_name: "Zara" }], [garmentType, brand], produto(null));
    expect(pending).toEqual([
      { id: "GARMENT_TYPE", name: "Tipo de roupa", valueType: "list", options: garmentType.values, suggested: null },
    ]);
  });

  it("pré-seleciona quando a subcategoria do cadastro é a mesma palavra de uma opção", () => {
    const [pending] = pendingRequiredAttributes([], [garmentType], produto("blazer"));
    expect(pending!.suggested).toEqual({ id: "G2", name: "Blazer" });
  });

  it("ids resolvidos em outra etapa (tamanho/gênero) nunca aparecem como pendentes", () => {
    expect(pendingRequiredAttributes([], [size], produto(null), ["SIZE"])).toEqual([]);
  });

  it("obrigatório de lista fechada mandado sem value_id continua pendente (o candidato não vale)", () => {
    expect(pendingRequiredAttributes([{ id: "GARMENT_TYPE", value_name: "blazer" }], [garmentType], produto(null))).toHaveLength(1);
  });

  it("GTIN exigido já atendido por EMPTY_GTIN_REASON", () => {
    const gtin = attr({ id: "GTIN", tags: required });
    const reason = attr({ id: "EMPTY_GTIN_REASON", valueType: "list" });
    expect(pendingRequiredAttributes([{ id: "EMPTY_GTIN_REASON", value_id: "R1", value_name: "x" }], [gtin, reason], produto(null))).toEqual([]);
  });

  it("escolha em lista fechada vira { value_id, value_name } só se o id existir nas opções", () => {
    expect(extraAttributeCandidates([{ id: "GARMENT_TYPE", valueId: "G2", valueName: "Blazer" }], [garmentType])).toEqual([
      { id: "GARMENT_TYPE", value_id: "G2", value_name: "Blazer" },
    ]);
    expect(extraAttributeCandidates([{ id: "GARMENT_TYPE", valueId: "INVENTADO", valueName: "Paletó" }], [garmentType])).toEqual([]);
    expect(extraAttributeCandidates([{ id: "GARMENT_TYPE", valueName: "Paletó" }], [garmentType])).toEqual([]);
  });

  it("escolha em texto livre (string) vale mesmo fora das sugestões", () => {
    expect(extraAttributeCandidates([{ id: "BRAND", valueName: " Marca Própria " }], [brand])).toEqual([{ id: "BRAND", value_name: "Marca Própria" }]);
  });

  it("atributo que a categoria não tem é ignorado", () => {
    expect(extraAttributeCandidates([{ id: "NAO_EXISTE", valueName: "x" }], [brand])).toEqual([]);
  });
});

describe("skuAttribute / packageAttributes / gtinAttribute / sizeChartAttributes", () => {
  it("SKU vai em SELLER_SKU", () => {
    expect(skuAttribute("ERP-BERM-000001")).toEqual({ id: "SELLER_SKU", value_name: "ERP-BERM-000001" });
  });

  it("pacote em cm/g inteiros", () => {
    expect(packageAttributes({ altura_cm: 10, largura_cm: 30, comprimento_cm: 40, peso_g: 300 })).toEqual([
      { id: "SELLER_PACKAGE_HEIGHT", value_name: "10 cm" },
      { id: "SELLER_PACKAGE_WIDTH", value_name: "30 cm" },
      { id: "SELLER_PACKAGE_LENGTH", value_name: "40 cm" },
      { id: "SELLER_PACKAGE_WEIGHT", value_name: "300 g" },
    ]);
  });

  it("GTIN usa o value_id vindo da categoria, nunca fixo", () => {
    expect(gtinAttribute({ valueId: "17055160", valueName: "No registrado" })).toEqual({
      id: "EMPTY_GTIN_REASON",
      value_id: "17055160",
      value_name: "No registrado",
    });
  });

  it("tabela de medidas: SIZE + SIZE_GRID_ID + SIZE_GRID_ROW_ID", () => {
    expect(sizeChartAttributes("42", "chart-1", "chart-1:3")).toEqual([
      { id: "SIZE", value_name: "42" },
      { id: "SIZE_GRID_ID", value_name: "chart-1" },
      { id: "SIZE_GRID_ROW_ID", value_name: "chart-1:3" },
    ]);
  });
});

describe("genderAttribute (spec 012, seção 3.5; caracteristicas.genero — spec 005, 23/09/2026)", () => {
  const genderAttr = attr({ id: "GENDER", values: [{ id: "g1", name: "Masculino" }, { id: "g2", name: "Feminino" }] });

  it("sem genero: casa pelo departamento, sem diferenciar maiúscula/espaço", () => {
    expect(genderAttribute(null, " masculino ", genderAttr)).toEqual({ id: "GENDER", value_id: "g1", value_name: "Masculino" });
  });

  it("sem genero e departamento sem correspondência: null (nunca inventa)", () => {
    expect(genderAttribute(null, "Unissex", genderAttr)).toBeNull();
  });

  it("categoria sem GENDER: null", () => {
    expect(genderAttribute(null, "Masculino", undefined)).toBeNull();
  });

  it("'Unissexo' (003) casa com 'Sem gênero' via sinônimo conhecido (confirmado ao vivo, T043)", () => {
    const attrWithSemGenero = attr({ id: "GENDER", values: [{ id: "g1", name: "Masculino" }, { id: "g5", name: "Sem gênero" }] });
    expect(genderAttribute(null, "Unissexo", attrWithSemGenero)).toEqual({ id: "GENDER", value_id: "g5", value_name: "Sem gênero" });
  });

  it("'Unissexo' sem 'Sem gênero' na categoria: null (nunca inventa)", () => {
    expect(genderAttribute(null, "Unissexo", genderAttr)).toBeNull();
  });

  it("genero explícito tem prioridade sobre o departamento", () => {
    // Departamento "Unissexo" não bateria (categoria só tem Masculino/Feminino) — genero resolve.
    expect(genderAttribute("feminino", "Unissexo", genderAttr)).toEqual({ id: "GENDER", value_id: "g2", value_name: "Feminino" });
  });

  it("categoria só-feminina (ex.: Scarpins e Plataformas): genero='feminino' casa, departamento genérico não precisa", () => {
    const soFeminino = attr({ id: "GENDER", values: [{ id: "g2", name: "Feminino" }, { id: "g4", name: "Meninas" }] });
    expect(genderAttribute("feminino", "Unissexo", soFeminino)).toEqual({ id: "GENDER", value_id: "g2", value_name: "Feminino" });
  });

  it("genero='menino'/'menina' casam com 'Meninos'/'Meninas'", () => {
    const infantil = attr({ id: "GENDER", values: [{ id: "g3", name: "Meninos" }, { id: "g4", name: "Meninas" }] });
    expect(genderAttribute("menino", "Unissexo", infantil)).toEqual({ id: "GENDER", value_id: "g3", value_name: "Meninos" });
    expect(genderAttribute("menina", "Unissexo", infantil)).toEqual({ id: "GENDER", value_id: "g4", value_name: "Meninas" });
  });

  it("genero='unissex' casa com 'Sem gênero'", () => {
    const attrWithSemGenero = attr({ id: "GENDER", values: [{ id: "g1", name: "Masculino" }, { id: "g5", name: "Sem gênero" }] });
    expect(genderAttribute("unissex", "Masculino", attrWithSemGenero)).toEqual({ id: "GENDER", value_id: "g5", value_name: "Sem gênero" });
  });

  it("genero explícito sem correspondência na categoria: cai para o departamento (nunca falha silenciosamente)", () => {
    // Categoria só tem Masculino/Feminino: genero="menino" não bate, mas o departamento bate.
    expect(genderAttribute("menino", "masculino", genderAttr)).toEqual({ id: "GENDER", value_id: "g1", value_name: "Masculino" });
  });

  it("genero e departamento sem correspondência nenhuma: null (nunca inventa)", () => {
    expect(genderAttribute("menino", "Unissexo", genderAttr)).toBeNull();
  });
});

describe("brandAttribute / colorAttributes (spec 012, seção 3 — melhor esforço)", () => {
  it("marca só quando a categoria tem BRAND", () => {
    expect(brandAttribute("Levi's", true)).toEqual({ id: "BRAND", value_name: "Levi's" });
    expect(brandAttribute("Levi's", false)).toBeNull();
    expect(brandAttribute(null, true)).toBeNull();
  });

  it("cor usa MAIN_COLOR ou COLOR, conforme a categoria tiver", () => {
    expect(colorAttributes("Azul", [attr({ id: "MAIN_COLOR" })])).toEqual([{ id: "MAIN_COLOR", value_name: "Azul" }]);
    expect(colorAttributes("Azul", [attr({ id: "COLOR" })])).toEqual([{ id: "COLOR", value_name: "Azul" }]);
    expect(colorAttributes("Azul", [])).toEqual([]);
    expect(colorAttributes(null, [attr({ id: "COLOR" })])).toEqual([]);
  });

  it("envia os dois quando a categoria tem COLOR e MAIN_COLOR ao mesmo tempo (T043 — COLOR pode ser required e MAIN_COLOR não)", () => {
    expect(colorAttributes("Marrom", [attr({ id: "COLOR" }), attr({ id: "MAIN_COLOR" })])).toEqual([
      { id: "COLOR", value_name: "Marrom" },
      { id: "MAIN_COLOR", value_name: "Marrom" },
    ]);
  });

  it("resolve value_id quando a cor bate com um valor da lista da categoria (achado real 25/09/2026 — 'Attribute [MAIN_COLOR] is not valid, item values [(null:azul claro)]')", () => {
    expect(
      colorAttributes("azul claro", [attr({ id: "MAIN_COLOR", values: [{ id: "V1", name: "Azul claro" }, { id: "V2", name: "Azul" }] })]),
    ).toEqual([{ id: "MAIN_COLOR", value_id: "V1", value_name: "Azul claro" }]);
  });

  it("mesma palavra com grafia diferente casa (hífen/acento): 'azul claro' → 'Azul-claro', nunca 'Azul' (dados reais da categoria)", () => {
    expect(
      colorAttributes("azul claro", [attr({ id: "COLOR", values: [{ id: "52028", name: "Azul" }, { id: "52029", name: "Azul-claro" }] })]),
    ).toEqual([{ id: "COLOR", value_id: "52029", value_name: "Azul-claro" }]);
    expect(colorAttributes("azul petroleo", [attr({ id: "COLOR", values: [{ id: "52024", name: "Azul-petróleo" }] })])).toEqual([
      { id: "COLOR", value_id: "52024", value_name: "Azul-petróleo" },
    ]);
  });

  it("sem correspondência na lista: manda só value_name como antes, nunca aproxima pra um valor diferente (princípio I)", () => {
    expect(colorAttributes("Bege rosado", [attr({ id: "MAIN_COLOR", values: [{ id: "V1", name: "Azul" }] })])).toEqual([
      { id: "MAIN_COLOR", value_name: "Bege rosado" },
    ]);
  });
});

describe("materialAttributes (spec 012, seção 3 — melhor esforço; achado real 25/09/2026, categoria Camisas exigindo SHIRT_MATERIAL)", () => {
  it("acha o id específico da categoria terminado em _MATERIAL, nunca um MATERIAL genérico fixo", () => {
    expect(materialAttributes(["Algodão"], [attr({ id: "SHIRT_MATERIAL" })])).toEqual([{ id: "SHIRT_MATERIAL", value_name: "Algodão" }]);
  });

  it("também aceita um atributo chamado exatamente MATERIAL", () => {
    expect(materialAttributes(["Algodão"], [attr({ id: "MATERIAL" })])).toEqual([{ id: "MATERIAL", value_name: "Algodão" }]);
  });

  it("junta múltiplos materiais com vírgula", () => {
    expect(materialAttributes(["Algodão", "Elastano"], [attr({ id: "SHIRT_MATERIAL" })])).toEqual([
      { id: "SHIRT_MATERIAL", value_name: "Algodão, Elastano" },
    ]);
  });

  it("categoria sem nenhum atributo de material: lista vazia", () => {
    expect(materialAttributes(["Algodão"], [attr({ id: "COLOR" })])).toEqual([]);
  });

  it("peça sem material cadastrado: lista vazia, mesmo com a categoria exigindo", () => {
    expect(materialAttributes([], [attr({ id: "SHIRT_MATERIAL" })])).toEqual([]);
  });

  it("resolve value_id quando um dos materiais bate com um valor da lista da categoria (previsto em 25/09/2026 a partir do achado real do MAIN_COLOR — mesmo defeito, mesma correção)", () => {
    expect(
      materialAttributes(["Algodão"], [attr({ id: "SHIRT_MATERIAL", values: [{ id: "V1", name: "Algodão" }, { id: "V2", name: "Poliéster" }] })]),
    ).toEqual([{ id: "SHIRT_MATERIAL", value_id: "V1", value_name: "Algodão" }]);
  });

  it("com vários materiais, resolve pelo primeiro que bater na lista, ignorando a ordem de declaração da lista", () => {
    expect(
      materialAttributes(
        ["Elastano", "Algodão"],
        [attr({ id: "SHIRT_MATERIAL", values: [{ id: "V1", name: "Algodão" }, { id: "V2", name: "Poliéster" }] })],
      ),
    ).toEqual([{ id: "SHIRT_MATERIAL", value_id: "V1", value_name: "Algodão" }]);
  });

  it("sem correspondência na lista: cai pro texto livre unindo todos os materiais, nunca aproxima pra um valor diferente (princípio I)", () => {
    expect(materialAttributes(["Linho"], [attr({ id: "SHIRT_MATERIAL", values: [{ id: "V1", name: "Algodão" }] })])).toEqual([
      { id: "SHIRT_MATERIAL", value_name: "Linho" },
    ]);
  });
});

describe("modelAttribute (spec 012, seção 3 — MODEL exigido por muitas categorias de acessórios, T043)", () => {
  it("reaproveita identificacao.nome quando a categoria exige MODEL", () => {
    expect(modelAttribute("Bermuda Jeans", true)).toEqual({ id: "MODEL", value_name: "Bermuda Jeans" });
  });

  it("categoria sem MODEL: null", () => {
    expect(modelAttribute("Bermuda Jeans", false)).toBeNull();
  });
});

describe("isKnownGarmentMeasureAttribute (spec 012, seção 3.5; ADR-024)", () => {
  it("confirmados (parte de baixo): true", () => {
    expect(isKnownGarmentMeasureAttribute("GARMENT_WAIST_WIDTH_FROM")).toBe(true);
    expect(isKnownGarmentMeasureAttribute("GARMENT_INSEAM_LENGTH_FROM")).toBe(true);
  });

  it("busto (parte de cima) confirmado ao vivo no T060 (23/09/2026): true", () => {
    expect(isKnownGarmentMeasureAttribute("GARMENT_CHEST_WIDTH_FROM")).toBe(true);
  });

  it("ombro, manga e variantes _TO (parte de cima) confirmados ao vivo em 24/09/2026 (erro real publicando jaqueta): true", () => {
    expect(isKnownGarmentMeasureAttribute("GARMENT_SHOULDER_WIDTH_FROM")).toBe(true);
    expect(isKnownGarmentMeasureAttribute("GARMENT_SHOULDER_WIDTH_TO")).toBe(true);
    expect(isKnownGarmentMeasureAttribute("GARMENT_SLEEVE_LENGTH_FROM")).toBe(true);
    expect(isKnownGarmentMeasureAttribute("GARMENT_SLEEVE_LENGTH_TO")).toBe(true);
    expect(isKnownGarmentMeasureAttribute("GARMENT_CHEST_WIDTH_TO")).toBe(true);
    expect(isKnownGarmentMeasureAttribute("GARMENT_LENGTH_TO")).toBe(true);
  });

  it("medida ainda não vista contra a API real: false — nunca adivinhado", () => {
    expect(isKnownGarmentMeasureAttribute("GARMENT_NECK_WIDTH_FROM")).toBe(false);
  });
});

describe("garmentMeasureFieldName (spec 012, seção 3.5)", () => {
  it("devolve o campo de medidas (spec 005) para um GARMENT_* já mapeado", () => {
    expect(garmentMeasureFieldName("GARMENT_WAIST_WIDTH_FROM")).toBe("cintura");
    expect(garmentMeasureFieldName("GARMENT_CHEST_WIDTH_FROM")).toBe("busto");
    expect(garmentMeasureFieldName("GARMENT_CHEST_WIDTH_TO")).toBe("busto");
    expect(garmentMeasureFieldName("GARMENT_SHOULDER_WIDTH_FROM")).toBe("largura_ombro");
    expect(garmentMeasureFieldName("GARMENT_SLEEVE_LENGTH_TO")).toBe("comprimento_manga");
  });

  it("undefined para um GARMENT_* ainda não mapeado — nunca inventa", () => {
    expect(garmentMeasureFieldName("GARMENT_NECK_WIDTH_FROM")).toBeUndefined();
  });
});

describe("garmentMeasureAttributes (spec 012, seção 3.5; ADR-024/ADR-030)", () => {
  const medidas = makeProduct().medidas;

  it("mapeia os atributos confirmados de parte de baixo, com faixa de ±1cm nos _FROM (ADR-030)", () => {
    const result = garmentMeasureAttributes(
      ["GARMENT_WAIST_WIDTH_FROM", "GARMENT_HIP_WIDTH_FROM", "GARMENT_THIGH_WIDTH_FROM", "GARMENT_INSEAM_LENGTH_FROM"],
      medidas,
    );
    expect(result.missingAttributeIds).toEqual([]);
    expect(result.attributes).toEqual([
      { id: "GARMENT_WAIST_WIDTH_FROM", value_name: "79 cm" },
      { id: "GARMENT_HIP_WIDTH_FROM", value_name: "99 cm" },
      { id: "GARMENT_THIGH_WIDTH_FROM", value_name: "59 cm" },
      { id: "GARMENT_INSEAM_LENGTH_FROM", value_name: "69 cm" },
    ]);
  });

  it("mapeia busto (parte de cima, T060 — GARMENT_CHEST_WIDTH_FROM), com faixa de ±1cm (ADR-030)", () => {
    const result = garmentMeasureAttributes(["GARMENT_CHEST_WIDTH_FROM"], { ...medidas, busto: 92 });
    expect(result.missingAttributeIds).toEqual([]);
    expect(result.attributes).toEqual([{ id: "GARMENT_CHEST_WIDTH_FROM", value_name: "91 cm" }]);
  });

  it("mapeia ombro, manga e as variantes _TO de busto/comprimento: _FROM e _TO abrem uma faixa de ±1cm em torno do valor real (24/09/2026 erro real publicando jaqueta + 25/09/2026 erro real 'duplicated_measure_value' — ADR-030, o Mercado Livre recusa _FROM == _TO)", () => {
    const result = garmentMeasureAttributes(
      [
        "GARMENT_CHEST_WIDTH_FROM",
        "GARMENT_CHEST_WIDTH_TO",
        "GARMENT_LENGTH_FROM",
        "GARMENT_LENGTH_TO",
        "GARMENT_SHOULDER_WIDTH_FROM",
        "GARMENT_SHOULDER_WIDTH_TO",
        "GARMENT_SLEEVE_LENGTH_FROM",
        "GARMENT_SLEEVE_LENGTH_TO",
      ],
      { ...medidas, busto: 92, comprimento: 70, largura_ombro: 45, comprimento_manga: 60 },
    );
    expect(result.missingAttributeIds).toEqual([]);
    expect(result.attributes).toEqual([
      { id: "GARMENT_CHEST_WIDTH_FROM", value_name: "91 cm" },
      { id: "GARMENT_CHEST_WIDTH_TO", value_name: "93 cm" },
      { id: "GARMENT_LENGTH_FROM", value_name: "69 cm" },
      { id: "GARMENT_LENGTH_TO", value_name: "71 cm" },
      { id: "GARMENT_SHOULDER_WIDTH_FROM", value_name: "44 cm" },
      { id: "GARMENT_SHOULDER_WIDTH_TO", value_name: "46 cm" },
      { id: "GARMENT_SLEEVE_LENGTH_FROM", value_name: "59 cm" },
      { id: "GARMENT_SLEEVE_LENGTH_TO", value_name: "61 cm" },
    ]);
  });

  it("medida ausente (null) vira missingAttributeIds, não um valor inventado", () => {
    const result = garmentMeasureAttributes(["GARMENT_WAIST_WIDTH_FROM"], { ...medidas, cintura: null });
    expect(result.attributes).toEqual([]);
    expect(result.missingAttributeIds).toEqual(["GARMENT_WAIST_WIDTH_FROM"]);
  });

  it("atributo ainda não visto contra a API real vira missingAttributeIds — nunca adivinhado", () => {
    const result = garmentMeasureAttributes(["GARMENT_NECK_WIDTH_FROM"], medidas);
    expect(result.attributes).toEqual([]);
    expect(result.missingAttributeIds).toEqual(["GARMENT_NECK_WIDTH_FROM"]);
  });
});

describe("plainSizeAttribute (T043 — SIZE fora da tabela de medidas, ex.: 'Cintos'; revisão preventiva 25/09/2026)", () => {
  it("categoria sem SIZE declarado: texto livre, sem tentar resolver id", () => {
    expect(plainSizeAttribute("Único", [])).toEqual({ id: "SIZE", value_name: "Único" });
  });

  it("SIZE sem lista de valores (texto livre confirmado): texto livre, sem id", () => {
    expect(plainSizeAttribute("Único", [attr({ id: "SIZE" })])).toEqual({ id: "SIZE", value_name: "Único" });
  });

  it("SIZE com lista de valores e o tamanho bate: resolve value_id, por precaução (ainda não confirmado ao vivo se este SIZE avulso é lista fechada)", () => {
    expect(plainSizeAttribute("Único", [attr({ id: "SIZE", values: [{ id: "V1", name: "Único" }] })])).toEqual({
      id: "SIZE",
      value_id: "V1",
      value_name: "Único",
    });
  });
});

describe("normalizeFootwearSize / pickChartRow (spec 012, seção 3.5)", () => {
  it("número vira N,0 BR", () => {
    expect(normalizeFootwearSize("32")).toBe("32,0 BR");
  });

  it("já normalizado passa direto", () => {
    expect(normalizeFootwearSize("32,5 BR")).toBe("32,5 BR");
  });

  const rows: SizeChartRow[] = [
    { id: "c1:1", attributes: [{ id: "SIZE", values: ["32,0 BR"] }] },
    { id: "c1:2", attributes: [{ id: "SIZE", values: ["34,0 BR"] }] },
  ];

  it("calçado: acha a linha pelo SIZE só", () => {
    expect(pickChartRow(rows, [{ id: "SIZE", value: "34,0 BR" }])).toEqual(rows[1]);
  });

  it("sem linha correspondente: null (o conector decide criar/adicionar)", () => {
    expect(pickChartRow(rows, [{ id: "SIZE", value: "36,0 BR" }])).toBeNull();
  });

  it("roupa: exige SIZE + todos os GARMENT_* idênticos", () => {
    const clothingRows: SizeChartRow[] = [
      { id: "c2:1", attributes: [{ id: "SIZE", values: ["42"] }, { id: "GARMENT_WAIST_WIDTH_FROM", values: ["80 cm"] }] },
      { id: "c2:2", attributes: [{ id: "SIZE", values: ["42"] }, { id: "GARMENT_WAIST_WIDTH_FROM", values: ["82 cm"] }] },
    ];
    const match = pickChartRow(clothingRows, [
      { id: "SIZE", value: "42" },
      { id: "GARMENT_WAIST_WIDTH_FROM", value: "82 cm" },
    ]);
    expect(match).toEqual(clothingRows[1]);
  });
});

describe("availableSizeLabels (spec 012; achado real 24/09/2026)", () => {
  it("lista os rótulos de SIZE de cada linha, sem duplicatas", () => {
    const chartRows: SizeChartRow[] = [
      { id: "c1:1", attributes: [{ id: "SIZE", values: ["32,0 BR"] }] },
      { id: "c1:2", attributes: [{ id: "SIZE", values: ["34,0 BR"] }] },
      { id: "c1:3", attributes: [{ id: "SIZE", values: ["34,0 BR"] }] },
    ];
    expect(availableSizeLabels(chartRows)).toEqual(["32,0 BR", "34,0 BR"]);
  });

  it("linha sem atributo SIZE: ignorada, não quebra", () => {
    const chartRows: SizeChartRow[] = [{ id: "c1:1", attributes: [{ id: "GENDER", values: ["Feminino"] }] }];
    expect(availableSizeLabels(chartRows)).toEqual([]);
  });

  it("tabela vazia: lista vazia", () => {
    expect(availableSizeLabels([])).toEqual([]);
  });
});

describe("buildChartName / buildChartRowPayload / buildChartPayload (spec 012, seção 3.5)", () => {
  it("nome ≤ 60 caracteres, só letras/números/espaços", () => {
    const name = buildChartName("Camisas de um domínio com nome extremamente longo e cheio de detalhes", "Feminino");
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name).not.toMatch(/[^\p{L}\p{N}\s—]/u);
  });

  it("linha da tabela: SIZE + FILTRABLE_SIZE (espelha SIZE, exigido pelo Mercado Livre — T043) + os GARMENT_* dados", () => {
    expect(buildChartRowPayload("42", [{ id: "GARMENT_WAIST_WIDTH_FROM", value_name: "80 cm" }])).toEqual({
      attributes: [
        { id: "SIZE", values: ["42"] },
        { id: "FILTRABLE_SIZE", values: ["42"] },
        { id: "GARMENT_WAIST_WIDTH_FROM", values: ["80 cm"] },
      ],
    });
  });

  it("payload de criação da tabela inclui GENDER e a primeira linha", () => {
    const payload = buildChartPayload({
      name: "Tabela OpenERP Sample — Calças Masculino",
      domainId: "PANTS",
      genderValueName: "Masculino",
      sizeLabel: "42",
      garmentAttributes: [{ id: "GARMENT_WAIST_WIDTH_FROM", value_name: "80 cm" }],
    });
    expect(payload).toMatchObject({
      domainId: "PANTS",
      measureType: "CLOTHING_MEASURE",
      mainAttributeId: "SIZE",
      attributes: [{ id: "GENDER", values: ["Masculino"] }],
    });
    expect(payload.firstRow.attributes[0]).toEqual({ id: "SIZE", values: ["42"] });
  });

  it("com filtrableSize resolvido (ADR-033): FILTRABLE_SIZE manda { id, name }, não o texto solto — achado real 25/09/2026, 'Value 48 in attribute FILTRABLE_SIZE is incorrect' mesmo com valor limpo", () => {
    const row = buildChartRowPayload("48", [{ id: "GARMENT_WAIST_WIDTH_FROM", value_name: "80 cm" }], { id: "V123", name: "48" });
    expect(row.attributes).toEqual([
      { id: "SIZE", values: ["48"] },
      { id: "FILTRABLE_SIZE", values: [{ id: "V123", name: "48" }] },
      { id: "GARMENT_WAIST_WIDTH_FROM", values: ["80 cm"] },
    ]);
  });

  it("filtrableSize viaja de buildChartPayload até a primeira linha", () => {
    const payload = buildChartPayload({
      name: "Tabela OpenERP Sample — Camisas Masculino",
      domainId: "SHIRTS",
      genderValueName: "Masculino",
      sizeLabel: "48",
      garmentAttributes: [],
      filtrableSize: { id: "V123", name: "48" },
    });
    expect(payload.firstRow.attributes).toContainEqual({ id: "FILTRABLE_SIZE", values: [{ id: "V123", name: "48" }] });
  });
});

describe("resolveFiltrableSizeValue (ADR-033, achado real 25/09/2026 — FILTRABLE_SIZE é lista fechada, não texto livre)", () => {
  function filtrableSizeSpec(values: { id: string; name: string }[]): TechnicalSpecAttribute[] {
    return [{ id: "FILTRABLE_SIZE", name: "Tamanho filtrável", valueType: "list", tags: [], values }];
  }

  it("acha o valor cuja name bate com size", () => {
    const result = resolveFiltrableSizeValue(
      filtrableSizeSpec([
        { id: "V1", name: "38" },
        { id: "V2", name: "40" },
      ]),
      "40",
    );
    expect(result).toEqual({ id: "V2", name: "40" });
  });

  it("ignora maiúsculas/espaços nas pontas ao comparar", () => {
    const result = resolveFiltrableSizeValue(filtrableSizeSpec([{ id: "V1", name: "GG" }]), " gg ");
    expect(result).toEqual({ id: "V1", name: "GG" });
  });

  it("sem correspondência na lista: undefined — o chamador decide bloquear", () => {
    const result = resolveFiltrableSizeValue(filtrableSizeSpec([{ id: "V1", name: "38" }]), "FR 48 / US 19");
    expect(result).toBeUndefined();
  });

  it("domínio sem FILTRABLE_SIZE declarado (spec ausente): undefined, nunca lança", () => {
    expect(resolveFiltrableSizeValue([], "42")).toBeUndefined();
  });

  it("FILTRABLE_SIZE declarado mas sem values (não é lista fechada nesse domínio): undefined", () => {
    expect(resolveFiltrableSizeValue(filtrableSizeSpec([]), "42")).toBeUndefined();
  });
});

describe("truncateName / buildPictureUrls / sanitizePlainText / immediateTag", () => {
  it("truncateName corta sem passar do limite", () => {
    expect(truncateName("abcdef", 3)).toBe("abc");
    expect(truncateName("ab", 3)).toBe("ab");
  });

  it("buildPictureUrls: capa primeiro, sem duplicar, respeita o limite da categoria", () => {
    const product = makeProduct();
    expect(buildPictureUrls(product, undefined)).toEqual(["https://x/1.jpg", "https://x/2.jpg"]);
    expect(buildPictureUrls(product, 1)).toEqual(["https://x/1.jpg"]);
  });

  it("buildPictureUrls sem foto principal usa só a galeria", () => {
    const product = makeProduct({ imagens: { principal: null, galeria: [{ id: "img2", url: "https://x/2.jpg", ordem: 0, tipo: null }] } });
    expect(buildPictureUrls(product, undefined)).toEqual(["https://x/2.jpg"]);
  });

  it("sanitizePlainText normaliza CRLF e corta no limite, sem tentar filtrar HTML/emoji", () => {
    expect(sanitizePlainText("linha1\r\nlinha2", undefined)).toBe("linha1\nlinha2");
    expect(sanitizePlainText("0123456789", 5)).toBe("01234");
  });

  it("immediateTag só quando a categoria exige", () => {
    expect(immediateTag("required")).toEqual(["immediate_payment"]);
    expect(immediateTag(undefined)).toEqual([]);
    expect(immediateTag("optional")).toEqual([]);
  });
});

describe("assertPriceInRange (spec 012, seção 6)", () => {
  it("dentro da faixa: não lança", () => {
    expect(() => assertPriceInRange(100, 10, 1000)).not.toThrow();
  });

  it("abaixo do mínimo: PriceOutOfRangeError", () => {
    expect(() => assertPriceInRange(5, 10, 1000)).toThrow(PriceOutOfRangeError);
  });

  it("acima do máximo: PriceOutOfRangeError", () => {
    expect(() => assertPriceInRange(2000, 10, 1000)).toThrow(PriceOutOfRangeError);
  });

  it("máximo null: sem teto", () => {
    expect(() => assertPriceInRange(1_000_000, 10, null)).not.toThrow();
  });
});

describe("warrantyTerms (spec 012, seção 6)", () => {
  it("sempre vazio — mapCondition nunca produz Recondicionado", () => {
    expect(warrantyTerms()).toEqual([]);
  });
});

describe("buildCreatePayload (spec 012, seções 3, 3.3)", () => {
  const baseInput = {
    categoryId: "MLB1234",
    name: "Bermuda Jeans",
    price: 89.9,
    attributes: [{ id: "SELLER_SKU", value_name: "ERP-BERM-000001" }],
    pictureUrls: ["https://x/1.jpg"],
    listingTypeId: "free",
    tags: [],
  };

  it("modelo User Products: family_name, nunca title", () => {
    const payload = buildCreatePayload({ ...baseInput, useUserProducts: true });
    expect(payload).toMatchObject({ family_name: "Bermuda Jeans" });
    expect(payload).not.toHaveProperty("title");
  });

  it("modelo antigo: title, nunca family_name", () => {
    const payload = buildCreatePayload({ ...baseInput, useUserProducts: false });
    expect(payload).toMatchObject({ title: "Bermuda Jeans" });
    expect(payload).not.toHaveProperty("family_name");
  });

  it("nunca envia condition (campo descontinuado)", () => {
    const payload = buildCreatePayload({ ...baseInput, useUserProducts: true });
    expect(payload).not.toHaveProperty("condition");
  });

  it("available_quantity sempre 1, buying_mode fixo", () => {
    const payload = buildCreatePayload({ ...baseInput, useUserProducts: true });
    expect(payload).toMatchObject({ available_quantity: 1, buying_mode: "buy_it_now", currency_id: "BRL" });
  });

  it("tags só aparece quando não vazio", () => {
    expect(buildCreatePayload({ ...baseInput, useUserProducts: true, tags: [] })).not.toHaveProperty("tags");
    expect(buildCreatePayload({ ...baseInput, useUserProducts: true, tags: ["immediate_payment"] })).toMatchObject({
      tags: ["immediate_payment"],
    });
  });

  it("shipping (achado real 24/09/2026): só aparece quando escolhido na revisão", () => {
    expect(buildCreatePayload({ ...baseInput, useUserProducts: true })).not.toHaveProperty("shipping");
    expect(buildCreatePayload({ ...baseInput, useUserProducts: true, shipping: null })).not.toHaveProperty("shipping");
    expect(
      buildCreatePayload({ ...baseInput, useUserProducts: true, shipping: { mode: "me2", logisticType: "self_service", freeShipping: true } }),
    ).toMatchObject({ shipping: { mode: "me2", logistic_type: "self_service", free_shipping: true } });
  });
});

describe("buildUpdatePayload (spec 012, seção 3.1)", () => {
  const baseInput = {
    name: "Bermuda Jeans",
    price: 79.9,
    attributes: [{ id: "SELLER_SKU", value_name: "ERP-BERM-000001" }],
    pictureUrls: ["https://x/1.jpg"],
  };

  it("modelo User Products: NUNCA reenvia family_name, mesmo sem vendas (confirmado ao vivo, T044 — 'The field family name is invalid')", () => {
    expect(buildUpdatePayload({ ...baseInput, useUserProducts: true, soldQuantity: 0 })).not.toHaveProperty("family_name");
    expect(buildUpdatePayload({ ...baseInput, useUserProducts: true, soldQuantity: 3 })).not.toHaveProperty("family_name");
  });

  it("modelo antigo, sem vendas: reenvia title", () => {
    const payload = buildUpdatePayload({ ...baseInput, useUserProducts: false, soldQuantity: 0 });
    expect(payload).toMatchObject({ title: "Bermuda Jeans" });
  });

  it("modelo antigo, com vendas: NÃO reenvia title (spec 012, seção 3.1)", () => {
    const payload = buildUpdatePayload({ ...baseInput, useUserProducts: false, soldQuantity: 3 });
    expect(payload).not.toHaveProperty("title");
  });

  it("sempre reenvia pictures e attributes, mesmo sem mudança", () => {
    const payload = buildUpdatePayload({ ...baseInput, useUserProducts: true, soldQuantity: 0 });
    expect(payload).toMatchObject({ pictures: [{ source: "https://x/1.jpg" }], attributes: baseInput.attributes });
  });

  it("nunca inclui category_id nem listing_type_id (não fazem parte da atualização)", () => {
    const payload = buildUpdatePayload({ ...baseInput, useUserProducts: true, soldQuantity: 0 });
    expect(payload).not.toHaveProperty("category_id");
    expect(payload).not.toHaveProperty("listing_type_id");
  });

  it("shipping (achado real 24/09/2026): só aparece quando escolhido na revisão", () => {
    expect(buildUpdatePayload({ ...baseInput, useUserProducts: true, soldQuantity: 0 })).not.toHaveProperty("shipping");
    expect(
      buildUpdatePayload({
        ...baseInput,
        useUserProducts: true,
        soldQuantity: 0,
        shipping: { mode: "not_specified", logisticType: "not_specified", freeShipping: false },
      }),
    ).toMatchObject({ shipping: { mode: "not_specified", logistic_type: "not_specified", free_shipping: false } });
  });
});
