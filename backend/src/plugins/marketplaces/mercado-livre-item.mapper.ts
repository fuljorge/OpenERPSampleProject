import type { Product } from "../../schemas/product.schema.js";
import type { CondicaoEstado } from "../../../../shared/dist/schemas/product.schema.js";
import type { CategoryAttribute, CreateSizeChartInput, CreateSizeChartRowInput, SizeChartRow, TechnicalSpecAttribute } from "./mercado-livre-api.client.js";
import type { ResolvedPackage } from "./mercado-livre-package.config.js";

/**
 * Funções puras que traduzem o produto do ERP para o formato do Mercado Livre (spec 012, seções
 * 3 a 6). Nenhuma chamada de rede aqui — o conector (T024/T025/T026) busca os dados (categoria,
 * tabela de medidas, pacote) e chama estas funções para montar o payload. `categoryId` e
 * `listingTypeId` chegam já resolvidos pela revisão do operador (spec 012, seção 4; ADR-025,
 * ADR-026) — este módulo nunca chama o preditor nem decide o tipo de anúncio.
 */

export class MercadoLivreMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MercadoLivreMappingError";
  }
}

export interface MercadoLivreAttributeCandidate {
  id: string;
  value_id?: string;
  value_name?: string;
}

// ---------------------------------------------------------------------------------------------
// Condição (spec 012, seção 3)

const CONDITION_LABEL: Record<CondicaoEstado, "Novo" | "Usado"> = {
  novo: "Novo",
  seminovo: "Usado",
  usado: "Usado",
};

/**
 * `novo → "Novo"`; `seminovo`/`usado → "Usado"` (o Mercado Livre não distingue seminovo). O
 * `value_id` vem sempre da categoria, nunca fixado aqui — sem o atributo ou sem o valor
 * correspondente, falha com mensagem clara em vez de adivinhar.
 */
export function mapCondition(estado: CondicaoEstado, itemConditionAttribute: CategoryAttribute | undefined): MercadoLivreAttributeCandidate {
  const label = CONDITION_LABEL[estado];
  if (!itemConditionAttribute) {
    throw new MercadoLivreMappingError("A categoria não tem o atributo ITEM_CONDITION — não é possível informar a condição da peça.");
  }
  const match = itemConditionAttribute.values.find((v) => v.name === label);
  if (!match) {
    throw new MercadoLivreMappingError(`A categoria não aceita a condição "${label}".`);
  }
  return { id: "ITEM_CONDITION", value_id: match.id, value_name: match.name };
}

const TOP_LEVEL_CONDITION: Record<CondicaoEstado, "new" | "used"> = {
  novo: "new",
  seminovo: "used",
  usado: "used",
};

/** `condition` de nível raiz do item (`POST /items`, `getShippingModes` — spec 012, achado real
 * 24/09/2026) — vocabulário em inglês minúsculo, diferente do valor localizado do atributo
 * `ITEM_CONDITION` (`mapCondition`, acima). Mesmo mapeamento novo/seminovo→usado. */
export function topLevelCondition(estado: CondicaoEstado): "new" | "used" {
  return TOP_LEVEL_CONDITION[estado];
}

// ---------------------------------------------------------------------------------------------
// Filtro final de atributos (spec 012, seção 4)

/**
 * Só o que a categoria de fato aceita; nunca `read_only`, `fixed` ou `inferred` (o Mercado Livre
 * preenche sozinho). Atributo `value_type: "list"` (lista fechada) sem `value_id` também sai —
 * nunca é aceito só com texto (ADR-035, achado real 25/09/2026: `"Attribute [MAIN_COLOR] is not
 * valid, item values [(null:azul claro)]"`, num atributo que nem era obrigatório). Se ele for
 * obrigatório, `pendingRequiredAttributes` aponta a falta antes de publicar.
 */
export function pickAttributes(
  candidates: MercadoLivreAttributeCandidate[],
  categoryAttributes: CategoryAttribute[],
): MercadoLivreAttributeCandidate[] {
  const byId = new Map(categoryAttributes.map((a) => [a.id, a]));
  return candidates.filter((candidate) => {
    const attribute = byId.get(candidate.id);
    if (!attribute) return false;
    if (attribute.tags.readOnly || attribute.tags.fixed || attribute.tags.inferred) return false;
    if (attribute.valueType === "list" && !candidate.value_id) return false;
    return true;
  });
}

export interface PendingRequiredAttribute {
  id: string;
  name: string;
  valueType: string | undefined;
  /** Valores da categoria — em `list`, os únicos aceitos; em `string`, só sugestões. */
  options: { id: string; name: string }[];
  /** Pré-seleção quando `classificacao.subcategoria` do cadastro bate exatamente com uma opção. */
  suggested: { id: string; name: string } | null;
}

/**
 * Obrigatórios da categoria que o cadastro não cobre (ADR-035) — o ERP não tem campo para
 * "tipo de roupa", "tipo de manga", "tipo de calça" etc., e a varredura das 207 categorias da
 * lista curada (25/09/2026) achou ~28 atributos assim. Em vez de mapear um por um conforme cada
 * publicação falha, a revisão pergunta ao operador. `alreadyHandled`: ids que outra parte do
 * fluxo resolve depois (tabela de medidas, `SIZE`/`GENDER`) — nunca listados como pendentes.
 */
export function pendingRequiredAttributes(
  candidates: MercadoLivreAttributeCandidate[],
  categoryAttributes: CategoryAttribute[],
  product: Pick<Product, "classificacao">,
  alreadyHandled: string[] = [],
): PendingRequiredAttribute[] {
  const kept = new Set(pickAttributes(candidates, categoryAttributes).map((c) => c.id));
  // `GTIN` exigido já é atendido por `EMPTY_GTIN_REASON` (spec 012, seção 5).
  if (kept.has("EMPTY_GTIN_REASON")) kept.add("GTIN");
  const skip = new Set(alreadyHandled);
  const subcategoria = product.classificacao.subcategoria;

  return categoryAttributes
    .filter((a) => a.tags.required && !a.tags.readOnly && !a.tags.fixed && !a.tags.inferred)
    .filter((a) => !kept.has(a.id) && !skip.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      valueType: a.valueType,
      options: a.values,
      suggested: subcategoria ? (resolveListValue(a, [subcategoria]) ?? null) : null,
    }));
}

export interface ExtraAttributeChoice {
  id: string;
  valueId?: string | null;
  valueName: string;
}

/**
 * Converte as escolhas do operador na revisão (ADR-035) em candidatos. Em atributo de lista
 * fechada, só vale um `valueId` que exista nas opções da categoria — qualquer outra coisa é
 * descartada aqui (e o obrigatório volta a aparecer como pendente), nunca repassada crua.
 */
export function extraAttributeCandidates(
  choices: ExtraAttributeChoice[],
  categoryAttributes: CategoryAttribute[],
): MercadoLivreAttributeCandidate[] {
  const byId = new Map(categoryAttributes.map((a) => [a.id, a]));
  const result: MercadoLivreAttributeCandidate[] = [];
  for (const choice of choices) {
    const def = byId.get(choice.id);
    if (!def) continue;
    const option = choice.valueId ? def.values.find((v) => v.id === choice.valueId) : undefined;
    if (option) {
      result.push({ id: def.id, value_id: option.id, value_name: option.name });
    } else if (def.valueType !== "list" && choice.valueName.trim()) {
      result.push({ id: def.id, value_name: choice.valueName.trim() });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Atributos individuais (spec 012, seção 3)

/** SKU do ERP em `SELLER_SKU` (nunca `seller_custom_field`) — identifica a peça se a resposta do `POST` se perder. */
export function skuAttribute(sku: string): MercadoLivreAttributeCandidate {
  return { id: "SELLER_SKU", value_name: sku };
}

/** Dimensões e peso do pacote, sempre inteiros, no formato `"{n} cm"`/`"{n} g"` (spec 012, seção 3.4). */
export function packageAttributes(pkg: ResolvedPackage): MercadoLivreAttributeCandidate[] {
  return [
    { id: "SELLER_PACKAGE_HEIGHT", value_name: `${pkg.altura_cm} cm` },
    { id: "SELLER_PACKAGE_WIDTH", value_name: `${pkg.largura_cm} cm` },
    { id: "SELLER_PACKAGE_LENGTH", value_name: `${pkg.comprimento_cm} cm` },
    { id: "SELLER_PACKAGE_WEIGHT", value_name: `${pkg.peso_g} g` },
  ];
}

/** Peça de brechó nunca tem GTIN válido — `EMPTY_GTIN_REASON`, com o `value_id` sempre vindo da categoria (spec 012, seção 5). */
export function gtinAttribute(reason: { valueId: string; valueName: string }): MercadoLivreAttributeCandidate {
  return { id: "EMPTY_GTIN_REASON", value_id: reason.valueId, value_name: reason.valueName };
}

/**
 * Sinônimo conhecido — confirmado ao vivo (T043): o departamento "Unissexo" (003) não bate
 * textualmente com nenhum valor de `GENDER` do Mercado Livre ("Sem gênero", "Sem gênero infantil"
 * — nunca "Unissexo"). Só esse par; qualquer outro departamento sem correspondência continua
 * devolvendo `null` (nunca inventa).
 */
const DEPARTAMENTO_GENDER_SYNONYMS: Record<string, string> = {
  unissexo: "sem gênero",
};

/**
 * `caracteristicas.genero` (005) → nome esperado pelo Mercado Livre — mapeamento fechado e
 * determinístico (o campo já é um enum fechado, ao contrário do departamento em texto livre).
 * Decisão do usuário (23/09/2026): categorias como "Scarpins e Plataformas" exigem `GENDER` e só
 * aceitam Feminino/Meninas — o departamento genérico "Unissexo" (categoria inteira, spec 003) não
 * é preciso o bastante para essas.
 */
const GENERO_TO_ML_NAME: Record<string, string> = {
  masculino: "masculino",
  feminino: "feminino",
  menino: "meninos",
  menina: "meninas",
  unissex: "sem gênero",
};

function findGenderValue(genderAttributeDef: CategoryAttribute, name: string): MercadoLivreAttributeCandidate | null {
  const match = genderAttributeDef.values.find((v) => v.name.trim().toLowerCase() === name);
  return match ? { id: "GENDER", value_id: match.id, value_name: match.name } : null;
}

/**
 * `GENDER` da peça — tenta primeiro `genero` (explícito, spec 005), depois o departamento (melhor
 * esforço, sem acento/maiúscula), casado com os valores que a categoria de fato aceita — nunca
 * inventa um `value_id`. `null` se não houver correspondência com nenhum dos dois (a categoria não
 * tem `GENDER`, ou nenhum valor bate, mesmo com o sinônimo do departamento).
 */
export function genderAttribute(
  genero: string | null,
  departamento: string,
  genderAttributeDef: CategoryAttribute | undefined,
): MercadoLivreAttributeCandidate | null {
  if (!genderAttributeDef) return null;

  if (genero !== null) {
    const byGenero = findGenderValue(genderAttributeDef, GENERO_TO_ML_NAME[genero]!);
    if (byGenero) return byGenero;
  }

  const normalizedDepartamento = departamento.trim().toLowerCase();
  const departamentoCandidates = [normalizedDepartamento, DEPARTAMENTO_GENDER_SYNONYMS[normalizedDepartamento]].filter(
    (v): v is string => v !== undefined,
  );
  const match = genderAttributeDef.values.find((v) => departamentoCandidates.includes(v.name.trim().toLowerCase()));
  if (!match) return null;
  return { id: "GENDER", value_id: match.id, value_name: match.name };
}

/**
 * Marca — melhor esforço, só quando a categoria tem `BRAND` (spec 012, seção 3). `BRAND` é
 * `string` (texto livre aceito, marca não catalogada incluída) — confirmado pela API e por várias
 * publicações reais bem-sucedidas.
 */
export function brandAttribute(marcaNome: string | null, hasBrandAttribute: boolean): MercadoLivreAttributeCandidate | null {
  if (!marcaNome || !hasBrandAttribute) return null;
  return { id: "BRAND", value_name: marcaNome };
}

/**
 * `MODEL` — muitas categorias de acessórios/moda exigem esse atributo de texto livre ("o nome
 * específico do produto", não documentado em nenhuma fonte salva; confirmado ao vivo, T043). O
 * ERP não tem um campo "modelo" — decisão (22/09/2026): reaproveitar `identificacao.nome`, dado
 * real do cadastro, nunca um texto genérico inventado.
 */
export function modelAttribute(nome: string, hasModelAttribute: boolean): MercadoLivreAttributeCandidate | null {
  if (!hasModelAttribute) return null;
  return { id: "MODEL", value_name: nome };
}

/** Mesma palavra, grafia diferente: sem acento, hífen vira espaço, espaços colapsados. Nunca
 * sinônimo nem palavra parecida ("azul claro" casa com "Azul-claro", nunca com "Azul"). */
function normalizeValueName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Acha, em `def.values`, o item cuja `name` é a mesma palavra de um dos candidatos
 * (`normalizeValueName`). `undefined` sem correspondência — nunca aproxima pra um valor diferente
 * do cadastro (princípio I).
 *
 * Tipos de atributo (dados reais de `GET /categories/{id}/attributes`, 25/09/2026, ADR-035):
 * - `value_type: "string"` (`BRAND`, `MODEL`, `COLOR`, `SIZE`, `*_MATERIAL`...): texto livre é
 *   aceito — `values` é só sugestão; mandar o `value_id` quando casa é um bônus, não exigência.
 * - `value_type: "list"` (`GENDER`, `MAIN_COLOR`, `ITEM_CONDITION`, `EMPTY_GTIN_REASON`,
 *   `FILTRABLE_SIZE`...): lista fechada, `value_id` obrigatório — `pickAttributes` descarta o
 *   candidato sem ele em vez de deixar o Mercado Livre recusar o anúncio inteiro.
 */
function resolveListValue(def: CategoryAttribute, candidates: string[]): { id: string; name: string } | undefined {
  const normalized = candidates.map(normalizeValueName);
  return def.values.find((v) => normalized.includes(normalizeValueName(v.name)));
}

/**
 * Cor principal — melhor esforço, em `COLOR` e/ou `MAIN_COLOR`, conforme a categoria tiver.
 * Envia os dois quando a categoria tem os dois: confirmado ao vivo (T043) que algumas categorias
 * têm `COLOR` como `required` e `MAIN_COLOR` como opcional ao mesmo tempo — usar só um dos dois
 * (a escolha antiga priorizava `MAIN_COLOR`) deixava de enviar o que era exigido.
 *
 * `COLOR` é `string` (texto livre aceito); `MAIN_COLOR` é `list` com ~16 cores genéricas e
 * opcional — sem correspondência, o candidato sem `value_id` é descartado por `pickAttributes`
 * (achado real 25/09/2026: `"Attribute [MAIN_COLOR] is not valid, item values [(null:azul
 * claro)]"` derrubava o anúncio inteiro por um atributo opcional; ADR-035).
 */
export function colorAttributes(cor: string | null, categoryAttributes: CategoryAttribute[]): MercadoLivreAttributeCandidate[] {
  if (!cor) return [];
  const defs = categoryAttributes.filter((a) => a.id === "COLOR" || a.id === "MAIN_COLOR");
  return defs.map((def) => {
    const match = resolveListValue(def, [cor]);
    return match ? { id: def.id, value_id: match.id, value_name: match.name } : { id: def.id, value_name: cor };
  });
}

/**
 * Material/composição — melhor esforço, mesmo espírito de `colorAttributes` (ver
 * `resolveListValue`). Cada categoria de moda tem seu próprio id específico pra isso em vez de
 * um `MATERIAL` genérico — achado real ao vivo, 25/09/2026: `"The attributes [SHIRT_MATERIAL]
 * are required for category ..."` (Camisas). Acha, entre os atributos da categoria, qualquer um
 * chamado exatamente `MATERIAL` ou terminado em `_MATERIAL` (`SHIRT_MATERIAL`, `PANTS_MATERIAL`
 * etc.) — nunca assume um id fixo. `caracteristicas.material` (spec 005) é uma lista (a peça
 * pode ter mais de um material) — `resolveListValue` tenta achar qualquer um deles na lista de
 * valores da categoria; sem nenhuma correspondência, cai pro texto livre unindo todos com
 * vírgula.
 */
export function materialAttributes(material: string[], categoryAttributes: CategoryAttribute[]): MercadoLivreAttributeCandidate[] {
  if (material.length === 0) return [];
  const defs = categoryAttributes.filter((a) => a.id === "MATERIAL" || a.id.endsWith("_MATERIAL"));
  const text = material.join(", ");
  return defs.map((def) => {
    const match = resolveListValue(def, material);
    return match ? { id: def.id, value_id: match.id, value_name: match.name } : { id: def.id, value_name: text };
  });
}

/**
 * `SIZE` fora do sistema de tabela de medidas — categoria com `SIZE` como atributo comum, sem
 * `catalogDomain`/tabela envolvida (confirmado ao vivo, T043: categoria "Cintos" exige `SIZE`
 * sem fazer parte de `active_domains`). `SIZE` é `string` nas categorias verificadas (texto livre
 * aceito); manda o `value_id` quando o tamanho casa com uma sugestão da categoria.
 */
export function plainSizeAttribute(size: string, categoryAttributes: CategoryAttribute[]): MercadoLivreAttributeCandidate {
  const def = categoryAttributes.find((a) => a.id === "SIZE");
  const match = def ? resolveListValue(def, [size]) : undefined;
  return match ? { id: "SIZE", value_id: match.id, value_name: match.name } : { id: "SIZE", value_name: size };
}

/** `SIZE`, `SIZE_GRID_ID` e `SIZE_GRID_ROW_ID` — moda com tabela de medidas (spec 012, seção 3.5). */
export function sizeChartAttributes(size: string, chartId: string, rowId: string): MercadoLivreAttributeCandidate[] {
  return [
    { id: "SIZE", value_name: size },
    { id: "SIZE_GRID_ID", value_name: chartId },
    { id: "SIZE_GRID_ROW_ID", value_name: rowId },
  ];
}

// ---------------------------------------------------------------------------------------------
// Medidas de roupa → GARMENT_* (spec 012, seção 3.5; ADR-024)

/**
 * Partes de baixo (calças/shorts/saias) confirmadas desde o T053/ADR-024. `GARMENT_CHEST_WIDTH_FROM`
 * (busto, partes de cima) confirmado ao vivo no T060 (23/09/2026, erro real do Mercado Livre num
 * casaco). Variantes `_TO` de busto/comprimento e as medidas de ombro/manga (previstas na spec 012,
 * seção 3.5, mas sem mapeamento até então) confirmadas ao vivo em 24/09/2026, erro real publicando
 * uma jaqueta: a categoria exigia `GARMENT_CHEST_WIDTH_TO`, `GARMENT_LENGTH_TO`,
 * `GARMENT_SHOULDER_WIDTH_FROM/TO` e `GARMENT_SLEEVE_LENGTH_FROM/TO`. Qualquer outra medida de
 * parte de cima que a spec 012 ainda não tenha confirmado continua sem mapeamento aqui —
 * `missingAttributeIds` a devolve como "não confirmada", nunca inventa.
 */
const GARMENT_MEASURE_BY_ATTRIBUTE: Record<string, keyof Product["medidas"]> = {
  GARMENT_LENGTH_FROM: "comprimento",
  GARMENT_LENGTH_TO: "comprimento",
  GARMENT_WAIST_WIDTH_FROM: "cintura",
  GARMENT_HIP_WIDTH_FROM: "quadril",
  GARMENT_THIGH_WIDTH_FROM: "coxa",
  GARMENT_INSEAM_LENGTH_FROM: "entrepasso",
  GARMENT_FRONT_RISE_FROM: "gancho",
  GARMENT_CHEST_WIDTH_FROM: "busto",
  GARMENT_CHEST_WIDTH_TO: "busto",
  GARMENT_SHOULDER_WIDTH_FROM: "largura_ombro",
  GARMENT_SHOULDER_WIDTH_TO: "largura_ombro",
  GARMENT_SLEEVE_LENGTH_FROM: "comprimento_manga",
  GARMENT_SLEEVE_LENGTH_TO: "comprimento_manga",
};

export interface GarmentMeasureResult {
  attributes: MercadoLivreAttributeCandidate[];
  /**
   * Atributos `GARMENT_*` que o domínio exige e que `medidas` não cobre — porque o campo é `null`
   * (peça sem essa medida preenchida) ou porque o atributo não está no mapeamento acima (domínio de
   * parte de cima ainda não confirmado, ADR-024 — nunca adivinhado). O conector decide a mensagem.
   */
  missingAttributeIds: string[];
}

/**
 * Tolerância (cm) usada só para satisfazer o par `_FROM`/`_TO` que o Mercado Livre exige por
 * atributo de medida — achado real ao vivo, 25/09/2026 (ADR-030): enviar o mesmo valor para
 * `_FROM` e `_TO` (a medida real única da peça, princípio X) é recusado como
 * `duplicated_measure_value` ("Duplicated measure in attribute ... was found in row ...") —
 * confirmado na documentação oficial do Mercado Livre (`size-guide-validations`) como um valor
 * de medida igual a outro já usado na mesma linha. `medidas` no cadastro do produto não muda —
 * continua com o valor real único da peça; só o par enviado ao Mercado Livre abre uma faixa
 * estreita em torno dele, pela exigência do schema deles, não por incerteza da medida.
 */
const MEASURE_RANGE_TOLERANCE_CM = 1;

function garmentMeasureValueName(attributeId: string, value: number, unidade: string): string {
  if (attributeId.endsWith("_FROM")) return `${value - MEASURE_RANGE_TOLERANCE_CM} ${unidade}`;
  if (attributeId.endsWith("_TO")) return `${value + MEASURE_RANGE_TOLERANCE_CM} ${unidade}`;
  return `${value} ${unidade}`;
}

/**
 * Monta os atributos `GARMENT_*` que o domínio exige (`requiredAttributeIds`, de
 * `technical_specs`), a partir de `medidas`. **Formato do valor**: mesma convenção do pacote
 * padrão (`"{n} {unidade}"`) — não documentado explicitamente para `GARMENT_*` nas fontes salvas;
 * a confirmar na Fase 8 (T043/T044) contra a API real.
 */
export function garmentMeasureAttributes(requiredAttributeIds: string[], medidas: Product["medidas"]): GarmentMeasureResult {
  const attributes: MercadoLivreAttributeCandidate[] = [];
  const missingAttributeIds: string[] = [];

  for (const attributeId of requiredAttributeIds) {
    const medidaKey = GARMENT_MEASURE_BY_ATTRIBUTE[attributeId];
    const value = medidaKey ? medidas[medidaKey] : undefined;
    if (medidaKey === undefined || value === null || value === undefined || typeof value !== "number") {
      missingAttributeIds.push(attributeId);
      continue;
    }
    attributes.push({ id: attributeId, value_name: garmentMeasureValueName(attributeId, value, medidas.unidade) });
  }

  return { attributes, missingAttributeIds };
}

/**
 * `true` se `attributeId` já tem mapeamento confirmado em `medidas` (ADR-024) — distingue, entre os
 * `missingAttributeIds` de `garmentMeasureAttributes`, "peça sem essa medida preenchida" (pedir para
 * completar o cadastro) de "domínio pede um atributo que o ERP ainda não captura" (extensão de
 * `MedidasSchema` necessária, nunca adivinhada).
 */
export function isKnownGarmentMeasureAttribute(attributeId: string): boolean {
  return attributeId in GARMENT_MEASURE_BY_ATTRIBUTE;
}

/** Campo de `medidas` (spec 005) correspondente a um `GARMENT_*` já mapeado — para mensagens de
 * erro que apontem o nome que o operador reconhece no cadastro, não o id do Mercado Livre. */
export function garmentMeasureFieldName(attributeId: string): string | undefined {
  return GARMENT_MEASURE_BY_ATTRIBUTE[attributeId];
}

// ---------------------------------------------------------------------------------------------
// Tabela de medidas — achar a linha certa (spec 012, seção 3.5)

/** `"32"` → `"32,0 BR"` (vocabulário das tabelas `STANDARD`/`BRAND` de calçado); já normalizado passa direto. */
export function normalizeFootwearSize(sizeLabel: string): string {
  const trimmed = sizeLabel.trim();
  if (/^\d+$/.test(trimmed)) return `${trimmed},0 BR`;
  return trimmed;
}

export interface ChartRowMatchCriterion {
  id: string;
  value: string;
}

/**
 * Acha a linha cuja combinação de atributos bate exatamente com `criteria` — calçado usa só
 * `SIZE`; roupa usa `SIZE` + todos os `GARMENT_*` (peças de tamanho igual podem ter medidas reais
 * diferentes, princípio X). `null` se nenhuma bater — o conector decide criar/adicionar linha.
 */
export function pickChartRow(rows: SizeChartRow[], criteria: ChartRowMatchCriterion[]): SizeChartRow | null {
  return (
    rows.find((row) =>
      criteria.every((criterion) => {
        const rowAttribute = row.attributes.find((a) => a.id === criterion.id);
        return rowAttribute?.values.includes(criterion.value) ?? false;
      }),
    ) ?? null
  );
}

/**
 * Rótulos de `SIZE` de todas as linhas de uma tabela (calçado, `BRAND`/`STANDARD`) — pra
 * mostrar ao operador quando o tamanho do cadastro não bate com nenhuma linha, em vez de só um
 * erro sem saída (spec 012; achado real 24/09/2026). Sem duplicatas, ordem da tabela preservada.
 */
export function availableSizeLabels(rows: SizeChartRow[]): string[] {
  const labels = rows
    .map((row) => row.attributes.find((a) => a.id === "SIZE")?.values[0])
    .filter((v): v is string => v !== undefined);
  return [...new Set(labels)];
}

// ---------------------------------------------------------------------------------------------
// Nome da tabela `SPECIFIC` (spec 012, seção 3.5)

/** ≤ 60 caracteres, só letras/números/espaços — o operador nunca digita o nome da tabela. */
export function buildChartName(domainName: string, genderName: string): string {
  // O Mercado Livre rejeitou "—" no nome (invalid_chart_name), confirmado ao vivo no T043, mesmo
  // dentro do limite de 60 caracteres — só letras, números e espaço (a regra de fato, apesar do
  // exemplo da spec 012, seção 3.5, mostrar um "—" que a API real não aceita).
  const raw = `Tabela Vovo Isabel ${domainName} ${genderName}`.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  return truncateName(raw, 60);
}

/**
 * `FILTRABLE_SIZE` é um atributo de **lista fechada** do domínio (ao contrário de `SIZE`, texto
 * livre) — achado real ao vivo, 25/09/2026: `"Value 48 in attribute FILTRABLE_SIZE is
 * incorrect"`, mesmo com um valor "limpo" enviado só como `{ name }`. A doc oficial de
 * `size-guide-validations` confirma que atributos de lista exigem o `id` do valor, obtido de
 * `technical_specs?section=grids` (`TechnicalSpecAttribute.values`). Acha o valor cuja `name`
 * bate com `size` (sem diferenciar maiúsculas/espaços nas pontas) — `undefined` se o domínio não
 * declarar `FILTRABLE_SIZE` como lista (alguns domínios podem não ter essa restrição) ou se
 * `size` não estiver entre os valores aceitos (o chamador decide se isso bloqueia ou não).
 */
export function resolveFiltrableSizeValue(
  requiredSpecs: TechnicalSpecAttribute[],
  size: string,
): { id: string; name: string } | undefined {
  const spec = requiredSpecs.find((s) => s.id === "FILTRABLE_SIZE");
  if (!spec || spec.values.length === 0) return undefined;
  const normalized = size.trim().toLowerCase();
  return spec.values.find((v) => v.name.trim().toLowerCase() === normalized);
}

/**
 * Corpo de `POST /catalog/charts/{id}/rows` — `SIZE` + todos os `GARMENT_*` da peça, mais
 * `FILTRABLE_SIZE` (espelha `SIZE`) — exigido pelo Mercado Livre e não documentado nas fontes
 * salvas; confirmado ao vivo no T043 (`required_row_attribute_not_found`). `filtrableSize`
 * (achado real 25/09/2026): quando o domínio declara `FILTRABLE_SIZE` como lista fechada, manda
 * o par `{ id, name }` resolvido (`resolveFiltrableSizeValue`) em vez do texto solto — sem isso,
 * o Mercado Livre recusa mesmo um valor "limpo" como `"48"`.
 */
export function buildChartRowPayload(
  sizeLabel: string,
  garmentAttributes: MercadoLivreAttributeCandidate[],
  filtrableSize?: { id: string; name: string },
): CreateSizeChartRowInput {
  return {
    attributes: [
      { id: "SIZE", values: [sizeLabel] },
      { id: "FILTRABLE_SIZE", values: [filtrableSize ?? sizeLabel] },
      ...garmentAttributes.map((a) => ({ id: a.id, values: [a.value_name ?? ""] })),
    ],
  };
}

/** Corpo de `POST /catalog/charts` (criar a tabela `SPECIFIC`, com a primeira linha — spec 012, seção 3.5). */
export function buildChartPayload(input: {
  name: string;
  domainId: string;
  genderValueName: string;
  sizeLabel: string;
  garmentAttributes: MercadoLivreAttributeCandidate[];
  filtrableSize?: { id: string; name: string };
}): CreateSizeChartInput {
  return {
    name: input.name,
    domainId: input.domainId,
    measureType: "CLOTHING_MEASURE",
    attributes: [{ id: "GENDER", values: [input.genderValueName] }],
    mainAttributeId: "SIZE",
    firstRow: buildChartRowPayload(input.sizeLabel, input.garmentAttributes, input.filtrableSize),
  };
}

// ---------------------------------------------------------------------------------------------
// Utilitários de texto/imagem (spec 012, seções 3, 4)

export function truncateName(name: string, maxLength: number): string {
  return name.length <= maxLength ? name : name.slice(0, maxLength).trimEnd();
}

/** Capa (`imagens.principal`) primeiro, depois a galeria em ordem, sem duplicar; corta em `maxPictures` (categoria). */
export function buildPictureUrls(product: Product, maxPictures: number | undefined): string[] {
  const urls: string[] = [];
  if (product.imagens.principal) urls.push(product.imagens.principal.url);
  for (const imagem of [...product.imagens.galeria].sort((a, b) => a.ordem - b.ordem)) {
    if (!urls.includes(imagem.url)) urls.push(imagem.url);
  }
  return maxPictures === undefined ? urls : urls.slice(0, maxPictures);
}

/**
 * Normaliza quebras de linha (`\r\n` → `\n`) e corta em `maxLength`. **Não** tenta remover
 * HTML/emoji sozinho — a validação real do Mercado Livre (`item.description.type.invalid`, spec
 * 012, seção 3.6) já aponta a posição do caractere problemático; tentar filtrar aqui arriscaria
 * mudar silenciosamente um texto que o operador escreveu de propósito.
 */
export function sanitizePlainText(text: string, maxLength: number | undefined): string {
  const normalized = text.replace(/\r\n/g, "\n");
  return maxLength !== undefined && normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

/** `tags: ["immediate_payment"]` só quando a categoria exige (spec 012, seção 3). */
export function immediateTag(immediatePayment: string | undefined): string[] {
  return immediatePayment === "required" ? ["immediate_payment"] : [];
}

export class PriceOutOfRangeError extends MercadoLivreMappingError {}

/** Falha **antes** de qualquer chamada de escrita se o preço estiver fora da faixa da categoria (spec 012, seção 6). */
export function assertPriceInRange(price: number, minimumPrice: number | null, maximumPrice: number | null): void {
  if (minimumPrice !== null && price < minimumPrice) {
    throw new PriceOutOfRangeError(
      `O preço de venda (R$ ${price.toFixed(2)}) está abaixo do mínimo aceito pela categoria (R$ ${minimumPrice.toFixed(2)}).`,
    );
  }
  if (maximumPrice !== null && price > maximumPrice) {
    throw new PriceOutOfRangeError(
      `O preço de venda (R$ ${price.toFixed(2)}) está acima do máximo aceito pela categoria (R$ ${maximumPrice.toFixed(2)}).`,
    );
  }
}

/**
 * Garantia (spec 012, seção 6): sem garantia por padrão. O Mercado Livre só exige quando
 * `ITEM_CONDITION = "Recondicionado"` — e `mapCondition` **nunca** mapeia para isso (o ERP não
 * distingue recondicionado ainda). Sempre vazio nesta versão; existe como função própria para
 * documentar a decisão e já ter onde crescer se o cadastro (005) um dia distinguir recondicionado.
 */
export function warrantyTerms(): MercadoLivreAttributeCandidate[] {
  return [];
}

// ---------------------------------------------------------------------------------------------
// Payload de criação/atualização (spec 012, seções 3, 3.1, 3.3)

/** Modo de frete escolhido na revisão (spec 012, achado real 24/09/2026) — `null`/ausente
 * quando o operador não escolheu nada (categorias sem opção aplicável, ou revisão pulada). */
export interface ShippingChoice {
  mode: string;
  logisticType: string;
  freeShipping: boolean;
}

function shippingPayload(shipping: ShippingChoice | null | undefined): Record<string, unknown> | undefined {
  if (!shipping) return undefined;
  return { mode: shipping.mode, logistic_type: shipping.logisticType, free_shipping: shipping.freeShipping };
}

export interface CreateItemPayloadInput {
  categoryId: string;
  /** `family_name` (modelo *User Products*) quando `true`; senão `title` (spec 012, seção 3.3). */
  useUserProducts: boolean;
  name: string;
  price: number;
  attributes: MercadoLivreAttributeCandidate[];
  pictureUrls: string[];
  listingTypeId: string;
  tags: string[];
  shipping?: ShippingChoice | null;
}

export function buildCreatePayload(input: CreateItemPayloadInput): Record<string, unknown> {
  const shipping = shippingPayload(input.shipping);
  return {
    category_id: input.categoryId,
    ...(input.useUserProducts ? { family_name: input.name } : { title: input.name }),
    price: input.price,
    currency_id: "BRL",
    available_quantity: 1,
    buying_mode: "buy_it_now",
    listing_type_id: input.listingTypeId,
    pictures: input.pictureUrls.map((url) => ({ source: url })),
    attributes: input.attributes,
    ...(input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(shipping ? { shipping } : {}),
  };
}

export interface UpdateItemPayloadInput {
  useUserProducts: boolean;
  name: string;
  /** `title` só é reenviado quando `soldQuantity === 0` (spec 012, seção 3.1) — `family_name` nunca, ver nota abaixo. */
  soldQuantity: number;
  price: number;
  attributes: MercadoLivreAttributeCandidate[];
  pictureUrls: string[];
  shipping?: ShippingChoice | null;
}

/**
 * `family_name` **nunca** é reenviado em `PUT /items/{id}` — confirmado ao vivo (T044,
 * 22/09/2026): o Mercado Livre rejeita com `"The field family name is invalid"` mesmo reenviando
 * o valor idêntico ou um texto simples sem acento, no modelo *User Products*. Diferente do que a
 * spec 012, seção 3.1, presumia ("family_name... só é editável enquanto sold_quantity = 0") —
 * editável talvez seja, mas não por este payload; a forma real de editar `family_name` de um item
 * já criado continua sem confirmação (possível endpoint próprio). `title` (modelo antigo) segue a
 * regra original, não testada ao vivo (a conta de produção já está no modelo *User Products*).
 */
export function buildUpdatePayload(input: UpdateItemPayloadInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    price: input.price,
    currency_id: "BRL",
    available_quantity: 1,
    pictures: input.pictureUrls.map((url) => ({ source: url })),
    attributes: input.attributes,
  };
  if (!input.useUserProducts && input.soldQuantity === 0) {
    payload.title = input.name;
  }
  const shipping = shippingPayload(input.shipping);
  if (shipping) payload.shipping = shipping;
  return payload;
}
