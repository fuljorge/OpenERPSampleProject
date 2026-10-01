import { getDb } from "../../database/mongo.client.js";
import { mercadoLivreOAuthClient } from "./mercado-livre-oauth.client.js";
import * as api from "./mercado-livre-api.client.js";
import type { CategoryAttribute, MercadoLivreWarning, SizeChartRow, SizeChartSummary } from "./mercado-livre-api.client.js";
import { MarketplaceConnectorError, type MarketplacePublishResult, type PublishInput } from "./marketplace-connector.port.js";
import { resolvePackage } from "./mercado-livre-package.config.js";
import {
  type ExtraAttributeChoice,
  type MercadoLivreAttributeCandidate,
  type PendingRequiredAttribute,
  assertPriceInRange,
  availableSizeLabels,
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
  normalizeFootwearSize,
  packageAttributes,
  pendingRequiredAttributes,
  pickAttributes,
  pickChartRow,
  plainSizeAttribute,
  resolveFiltrableSizeValue,
  sanitizePlainText,
  sizeChartAttributes,
  skuAttribute,
  topLevelCondition,
  warrantyTerms,
} from "./mercado-livre-item.mapper.js";
import type { Product } from "../../schemas/product.schema.js";

/**
 * Orquestra a criação/atualização de um anúncio (spec 012, seções 3, 3.1, 3.3, 3.5; T025/T026) —
 * chama a API (T022) e monta o payload com o mapeador puro (T023). `categoryId`/`listingTypeId`
 * chegam já resolvidos pela revisão do operador (ADR-025/ADR-026); esta função nunca chama o
 * preditor nem decide o tipo de anúncio.
 */
export async function publishItem(accessToken: string, input: PublishInput): Promise<MarketplacePublishResult> {
  const { product, listing } = input;
  const categoryId = input.categoryId;
  const listingTypeId = input.listingTypeId;
  const sizeOverride = input.sizeOverride;
  const shipping = input.shipping;
  const extraAttributes = input.extraAttributes ?? [];
  if (!categoryId) {
    throw new MarketplaceConnectorError("Nenhuma categoria confirmada — revise a categoria na tela de publicação antes de continuar.");
  }
  if (!listingTypeId) {
    throw new MarketplaceConnectorError("Nenhum tipo de anúncio escolhido — revise antes de publicar.");
  }
  const price = product.preco.preco_venda;
  if (price === null) {
    throw new MarketplaceConnectorError("Informe o preço de venda antes de publicar.");
  }

  const currentUser = await mercadoLivreOAuthClient.fetchCurrentUser(accessToken);
  const sellerId = String(currentUser.id);
  const useUserProducts = currentUser.tags.includes("user_product_seller");

  const settings = await api.getCategory(accessToken, categoryId);
  if (!settings.listingAllowed || settings.status !== "enabled") {
    throw new MarketplaceConnectorError(
      `A categoria escolhida não aceita novos anúncios no momento (${settings.status ?? "indisponível"}) — escolha outra categoria na revisão.`,
    );
  }
  assertPriceInRange(price, settings.minimumPrice, settings.maximumPrice);

  const categoryAttributes = await api.getCategoryAttributes(accessToken, categoryId);

  // Republicar (spec 012, seção 3.1): só quando a entrada já tem id_anuncio e status = publicado.
  if (listing?.id_anuncio && listing.status === "publicado") {
    return updateExistingItem(accessToken, listing.id_anuncio, product, categoryId, categoryAttributes, settings, useUserProducts, sellerId, sizeOverride, shipping, extraAttributes);
  }

  // Criar (entrada nova, ou recriar sobre um anúncio encerrado): resposta perdida — procura antes
  // pelo SKU, para nunca duplicar um item que já existe no Mercado Livre (spec 012, seção 3.1).
  const foundIds = await api.searchItemsBySellerSku(accessToken, sellerId, product.sku);
  if (foundIds.length > 0) {
    const items = await api.getItemsByIds(accessToken, foundIds.slice(0, 20));
    const adopted = items.find((item) => item.status !== "closed");
    if (adopted) {
      return updateExistingItem(accessToken, adopted.id, product, categoryId, categoryAttributes, settings, useUserProducts, sellerId, sizeOverride, shipping, extraAttributes);
    }
  }

  return createNewItem(accessToken, product, categoryId, categoryAttributes, settings, useUserProducts, listingTypeId, sellerId, sizeOverride, shipping, extraAttributes);
}

/**
 * `POST /catalog/charts/search` e `POST /catalog/charts` (T022 `searchSizeCharts`/`createSizeChart`)
 * esperam o `domain_id` **sem** o prefixo do site (ex.: `"SHORTS"`), diferente de todo o resto da
 * API (`GET /categories/{id}`, `active_domains`, `technical_specs`, o preditor — todos usam
 * `"MLB-SHORTS"`). Confirmado ao vivo no T043: sem isso, o Mercado Livre recusa com "Domain
 * MLB-MLB-SHORTS not active" (o `site_id` enviado à parte duplica o prefixo).
 */
function stripSitePrefix(domainId: string): string {
  const prefix = "MLB-";
  return domainId.startsWith(prefix) ? domainId.slice(prefix.length) : domainId;
}

function warningsToPendencia(warnings: MercadoLivreWarning[]): string | null {
  return warnings.length > 0 ? warnings.map((w) => w.message).join(" ") : null;
}

function appendPendencia(current: string | null, addition: string): string {
  return current ? `${current} ${addition}` : addition;
}

async function createNewItem(
  accessToken: string,
  product: Product,
  categoryId: string,
  categoryAttributes: CategoryAttribute[],
  settings: api.CategorySettings,
  useUserProducts: boolean,
  listingTypeId: string,
  sellerId: string,
  sizeOverride: string | null | undefined,
  shipping: PublishInput["shipping"],
  extraAttributes: ExtraAttributeChoice[],
): Promise<MarketplacePublishResult> {
  const attributes = await buildAttributes(accessToken, product, categoryId, categoryAttributes, settings, sellerId, sizeOverride, extraAttributes);

  const payload = buildCreatePayload({
    categoryId,
    useUserProducts,
    name: product.identificacao.nome,
    price: product.preco.preco_venda!,
    attributes,
    pictureUrls: buildPictureUrls(product, settings.maxPicturesPerItem),
    listingTypeId,
    tags: immediateTag(settings.immediatePayment),
    shipping,
  });

  const created = await api.createItem(accessToken, payload);
  let pendencia = warningsToPendencia(created.warnings);

  if (product.identificacao.descricao) {
    try {
      await api.createDescription(accessToken, created.id, sanitizePlainText(product.identificacao.descricao, settings.maxDescriptionLength));
    } catch (err) {
      const message = err instanceof api.MercadoLivreApiError ? err.message : "erro desconhecido ao enviar a descrição.";
      pendencia = appendPendencia(pendencia, `Anúncio criado, mas a descrição não foi enviada: ${message}`);
    }
  }

  return { id_anuncio: created.id, url_anuncio: created.permalink ?? "", pendencia };
}

async function updateExistingItem(
  accessToken: string,
  itemId: string,
  product: Product,
  categoryId: string,
  categoryAttributes: CategoryAttribute[],
  settings: api.CategorySettings,
  useUserProducts: boolean,
  sellerId: string,
  sizeOverride: string | null | undefined,
  shipping: PublishInput["shipping"],
  extraAttributes: ExtraAttributeChoice[],
): Promise<MarketplacePublishResult> {
  const currentItem = await api.getItem(accessToken, itemId);
  if (currentItem.status === "closed") {
    throw new MarketplaceConnectorError(
      'Este anúncio já foi encerrado no Mercado Livre — use "Encerrar anúncio" no ERP e publique de novo para criar um item novo.',
    );
  }

  const attributes = await buildAttributes(accessToken, product, categoryId, categoryAttributes, settings, sellerId, sizeOverride, extraAttributes);

  const payload = buildUpdatePayload({
    useUserProducts,
    name: product.identificacao.nome,
    soldQuantity: currentItem.soldQuantity,
    price: product.preco.preco_venda!,
    attributes,
    pictureUrls: buildPictureUrls(product, settings.maxPicturesPerItem),
    shipping,
  });

  const updated = await api.updateItem(accessToken, itemId, payload);
  let pendencia = warningsToPendencia(updated.warnings);

  if (product.identificacao.descricao) {
    const text = sanitizePlainText(product.identificacao.descricao, settings.maxDescriptionLength);
    try {
      await api.updateDescription(accessToken, itemId, text);
    } catch (err) {
      if (!(err instanceof api.MercadoLivreApiError)) throw err;
      // O item pode ainda não ter descrição (falha parcial anterior) — PUT falha, tenta POST.
      try {
        await api.createDescription(accessToken, itemId, text);
      } catch (err2) {
        const message = err2 instanceof api.MercadoLivreApiError ? err2.message : "erro desconhecido ao enviar a descrição.";
        pendencia = appendPendencia(pendencia, `A descrição não foi atualizada: ${message}`);
      }
    }
  }

  return { id_anuncio: itemId, url_anuncio: updated.permalink ?? currentItem.permalink ?? "", pendencia };
}

/** Resolvidos depois, pela tabela de medidas ou pelo ramo sem tabela — nunca pendentes na revisão. */
const SIZE_AND_GENDER_IDS = ["GENDER", "SIZE", "SIZE_GRID_ID", "SIZE_GRID_ROW_ID"];

/** Monta todos os candidatos a atributo e filtra pelo que a categoria de fato aceita (spec 012, seção 4). */
async function buildAttributes(
  accessToken: string,
  product: Product,
  categoryId: string,
  categoryAttributes: CategoryAttribute[],
  settings: api.CategorySettings,
  sellerId: string,
  sizeOverride: string | null | undefined,
  extraAttributes: ExtraAttributeChoice[],
): Promise<MercadoLivreAttributeCandidate[]> {
  // Escolha do operador na revisão (ADR-035) prevalece sobre o que o ERP deduziria sozinho.
  const extras = extraAttributeCandidates(extraAttributes, categoryAttributes);
  const extraIds = new Set(extras.map((c) => c.id));
  const base = await buildBaseCandidates(accessToken, product, categoryId, categoryAttributes);
  const candidates = [...base.filter((c) => !extraIds.has(c.id)), ...extras];

  // Antes de qualquer escrita — a tabela de medidas, logo abaixo, pode criar linha no Mercado Livre.
  const pending = pendingRequiredAttributes(candidates, categoryAttributes, product, SIZE_AND_GENDER_IDS);
  if (pending.length > 0) {
    throw new MarketplaceConnectorError(
      `O Mercado Livre exige, para esta categoria: ${pending.map((p) => p.name).join(", ")} — preencha na tela de revisão antes de publicar.`,
    );
  }

  // Moda com tabela de medidas (domínio em active_domains) já traz GENDER + SIZE (+ grid) prontos.
  // Fora disso, GENDER e SIZE ainda podem ser atributos comuns exigidos pela categoria — sem
  // tabela nenhuma envolvida (confirmado ao vivo, T043: categoria "Cintos" exige os dois sem
  // fazer parte de active_domains).
  const chartAttributes = settings.catalogDomain
    ? await resolveSizeChartAttributes(accessToken, product, settings.catalogDomain, categoryAttributes, sellerId, sizeOverride)
    : [];
  if (chartAttributes.length > 0) {
    candidates.push(...chartAttributes);
  } else {
    const genderDef = categoryAttributes.find((a) => a.id === "GENDER");
    const gender = genderAttribute(product.caracteristicas.genero, product.classificacao.departamento, genderDef);
    if (gender) candidates.push(gender);

    const plainSize = product.caracteristicas.tamanho_etiqueta ?? product.caracteristicas.tamanho_equivalente;
    if (plainSize) candidates.push(plainSizeAttribute(plainSize, categoryAttributes));
  }

  return pickAttributes(candidates, categoryAttributes);
}

/** Tudo que o cadastro preenche sozinho, fora tamanho/gênero — só leituras, nenhuma escrita. */
async function buildBaseCandidates(
  accessToken: string,
  product: Product,
  categoryId: string,
  categoryAttributes: CategoryAttribute[],
): Promise<MercadoLivreAttributeCandidate[]> {
  const itemConditionDef = categoryAttributes.find((a) => a.id === "ITEM_CONDITION");
  const candidates: MercadoLivreAttributeCandidate[] = [
    mapCondition(product.condicao.estado, itemConditionDef),
    skuAttribute(product.sku),
    ...warrantyTerms(),
  ];

  const brand = brandAttribute(
    product.marca.nome,
    categoryAttributes.some((a) => a.id === "BRAND"),
  );
  if (brand) candidates.push(brand);

  candidates.push(...colorAttributes(product.caracteristicas.cor_principal, categoryAttributes));
  candidates.push(...materialAttributes(product.caracteristicas.material, categoryAttributes));

  const model = modelAttribute(
    product.identificacao.nome,
    categoryAttributes.some((a) => a.id === "MODEL"),
  );
  if (model) candidates.push(model);

  const resolvedPackage = await resolvePackage(getDb(), product);
  candidates.push(...packageAttributes(resolvedPackage));

  const gtin = await resolveGtinAttribute(accessToken, categoryId, categoryAttributes);
  if (gtin) candidates.push(gtin);

  return candidates;
}

/**
 * Atributos obrigatórios da categoria que o cadastro não cobre, com as opções do Mercado Livre —
 * pra tela de revisão perguntar ao operador antes de publicar (ADR-035). Só leituras.
 */
export async function resolveAttributeSuggestion(accessToken: string, product: Product, categoryId: string): Promise<PendingRequiredAttribute[]> {
  const categoryAttributes = await api.getCategoryAttributes(accessToken, categoryId);
  const base = await buildBaseCandidates(accessToken, product, categoryId, categoryAttributes);
  return pendingRequiredAttributes(base, categoryAttributes, product, SIZE_AND_GENDER_IDS);
}

/** GTIN (spec 012, seção 5): exigido → `EMPTY_GTIN_REASON`, nunca um GTIN inventado. */
async function resolveGtinAttribute(
  accessToken: string,
  categoryId: string,
  categoryAttributes: CategoryAttribute[],
): Promise<MercadoLivreAttributeCandidate | null> {
  const gtinDef = categoryAttributes.find((a) => a.id === "GTIN");
  if (!gtinDef) return null;

  let required = gtinDef.tags.required;
  if (!required && gtinDef.tags.conditionalRequired) {
    // Corpo do item exigido pela documentação — a chamada é read-only (não publica nada); o
    // formato exato do "corpo do item" não está confirmado nas fontes salvas (a confirmar Fase 8).
    const requiredIds = await api.getConditionallyRequiredAttributes(accessToken, categoryId, { category_id: categoryId });
    required = requiredIds.includes("GTIN");
  }
  if (!required) return null;

  const reasonDef = categoryAttributes.find((a) => a.id === "EMPTY_GTIN_REASON");
  const reasonValue = reasonDef?.values.find((v) => v.name === "No registrado") ?? reasonDef?.values.find((v) => v.name === "Otro");
  if (!reasonDef || !reasonValue) {
    throw new MarketplaceConnectorError(
      "A categoria exige GTIN, mas o Mercado Livre não devolveu um motivo de ausência de GTIN disponível.",
    );
  }
  return gtinAttribute({ valueId: reasonValue.id, valueName: reasonValue.name });
}

/**
 * Moda com tabela de medidas (spec 012, seção 3.5; ADR-024) — devolve `GENDER` + `SIZE` +
 * `SIZE_GRID_ID` + `SIZE_GRID_ROW_ID`, ou `[]` se o domínio não estiver em `active_domains`.
 */
async function resolveSizeChartAttributes(
  accessToken: string,
  product: Product,
  domain: string,
  categoryAttributes: CategoryAttribute[],
  sellerId: string,
  sizeOverride: string | null | undefined,
): Promise<MercadoLivreAttributeCandidate[]> {
  const activeDomains = await api.getActiveSizeChartDomains(accessToken);
  if (!activeDomains.includes(domain)) return [];

  const genderDef = categoryAttributes.find((a) => a.id === "GENDER");
  const gender = genderAttribute(product.caracteristicas.genero, product.classificacao.departamento, genderDef);
  if (!gender?.value_id || !gender.value_name) {
    throw new MarketplaceConnectorError(
      product.caracteristicas.genero
        ? `O Mercado Livre não aceita o gênero "${product.caracteristicas.genero}" para esta categoria — ajuste o gênero da peça ou a categoria antes de publicar.`
        : `O Mercado Livre exige o gênero da peça para esta categoria e o departamento "${product.classificacao.departamento}" não é reconhecido — preencha "Gênero" no cadastro antes de publicar.`,
    );
  }

  // `sizeOverride`: tamanho escolhido pelo operador na revisão (spec 012, tela de tamanhos de
  // calçado, achado real 24/09/2026) — quando o `tamanho_etiqueta` do cadastro não bate com
  // nenhuma linha da tabela do Mercado Livre. Tem prioridade sobre o cadastro só pra esta
  // publicação; nunca é gravado de volta no produto.
  const size = sizeOverride ?? product.caracteristicas.tamanho_etiqueta ?? product.caracteristicas.tamanho_equivalente;
  if (!size) {
    throw new MarketplaceConnectorError("Informe o tamanho da peça (tamanho da etiqueta) para publicar esta categoria no Mercado Livre.");
  }

  // Calçado (T050): domínio SAPT — tabela BRAND/STANDARD, sempre (calçado não tem tabela própria
  // do vendedor). Demais domínios de moda: tenta reaproveitar uma tabela BRAND/STANDARD oficial
  // antes de medir a peça (ADR-030) — só cria/estende a SPECIFIC do vendedor (ADR-024), que exige
  // as medidas reais, quando nenhuma tabela oficial existir ou o tamanho da peça não estiver nela.
  if (product.classificacao.categoria_codigo === "SAPT") {
    const chartAttributes = await resolveFootwearChart(accessToken, domain, sellerId, size, gender.value_name, product.marca.nome);
    return [gender, ...chartAttributes];
  }

  const officialChart = await findBrandOrStandardChart(accessToken, domain, sellerId, gender.value_name, product.marca.nome);
  if (officialChart) {
    const officialDetail = await api.getSizeChart(accessToken, officialChart.id);
    const officialRow = pickChartRow(officialDetail.rows, [{ id: "SIZE", value: size }]);
    if (officialRow) {
      return [gender, ...sizeChartAttributes(size, officialChart.id, officialRow.id)];
    }
    // Tamanho não está na tabela oficial (marca/padrão) — ao contrário do calçado, roupa pode
    // criar/estender a própria tabela SPECIFIC (abaixo), então isso não bloqueia a publicação.
  }

  // T060: a ficha técnica de medidas é por gênero (CHILD_DEPENDENT) — sem o GENDER já resolvido no
  // corpo do POST, a resposta nunca traz os atributos GARMENT_*.
  const requiredSpecs = await api.getDomainSizeChartAttributes(accessToken, domain, { valueId: gender.value_id, valueName: gender.value_name });

  // FILTRABLE_SIZE (achado real 25/09/2026): atributo de lista fechada — um valor fora da lista
  // do domínio é recusado mesmo "limpo" (ex.: "48"), mesmo numa linha nova sem conflito nenhum.
  // Falha aqui, antes de qualquer escrita, com a lista real de valores aceitos — mesmo padrão de
  // "erro claro antes de tentar" já usado pra calçado (tamanho não encontrado) e medida em branco.
  const filtrableSizeSpec = requiredSpecs.find((spec) => spec.id === "FILTRABLE_SIZE");
  const filtrableSize = filtrableSizeSpec ? resolveFiltrableSizeValue(requiredSpecs, size) : undefined;
  if (filtrableSizeSpec && filtrableSizeSpec.values.length > 0 && !filtrableSize) {
    const acceptedValues = filtrableSizeSpec.values.map((v) => v.name);
    throw new MarketplaceConnectorError(
      `O tamanho "${size}" não é aceito pelo Mercado Livre para esta categoria. Tamanhos aceitos: ${acceptedValues.join(", ")}.`,
    );
  }

  const garmentAttributeIds = requiredSpecs.filter((spec) => spec.id.startsWith("GARMENT_")).map((spec) => spec.id);
  const { attributes: garmentAttributes, missingAttributeIds } = garmentMeasureAttributes(garmentAttributeIds, product.medidas);

  if (missingAttributeIds.length > 0) {
    const blank = missingAttributeIds.filter(isKnownGarmentMeasureAttribute);
    const unconfirmed = missingAttributeIds.filter((id) => !isKnownGarmentMeasureAttribute(id));
    if (blank.length > 0) {
      // Nome do campo de `medidas` (spec 005), não o id do Mercado Livre — é isso que o operador
      // reconhece no cadastro.
      const fields = blank.map((id) => garmentMeasureFieldName(id) ?? id);
      throw new MarketplaceConnectorError(`Informe as medidas da peça (${fields.join(", ")}) para publicar esta categoria no Mercado Livre.`);
    }
    // Nome real devolvido pelo Mercado Livre (technical_specs), não só o id — ajuda a mapear a
    // extensão de `MedidasSchema` sem precisar consultar a API de novo.
    const unconfirmedLabels = unconfirmed.map((id) => {
      const spec = requiredSpecs.find((s) => s.id === id);
      return spec && spec.name !== id ? `${spec.name} (${id})` : id;
    });
    throw new MarketplaceConnectorError(
      `Esta categoria do Mercado Livre exige medidas que o cadastro ainda não captura: ${unconfirmedLabels.join(", ")} — fale com o time técnico antes de publicar.`,
    );
  }

  const chartAttributes = await resolveClothingChart(accessToken, domain, sellerId, size, gender.value_name, garmentAttributes, filtrableSize);
  return [gender, ...chartAttributes];
}

/** Acha a tabela `BRAND` (se a marca da peça tiver uma) ou, senão, `STANDARD` — mesma ordem de
 * preferência do fluxo de publicação e da sugestão de tamanhos pra revisão (spec 012, seção 3.5).
 * Usada tanto por calçado quanto por roupa (ADR-030) — a busca em si não é específica de calçado,
 * só a normalização de `SIZE` (`normalizeFootwearSize`) é feita por quem chama. */
async function findBrandOrStandardChart(
  accessToken: string,
  domain: string,
  sellerId: string,
  genderValueName: string,
  brandName: string | null,
): Promise<SizeChartSummary | undefined> {
  if (brandName) {
    const brandCharts = await api.searchSizeCharts(accessToken, {
      domainId: stripSitePrefix(domain),
      sellerId,
      type: "BRAND",
      attributes: [
        { id: "GENDER", values: [genderValueName] },
        { id: "BRAND", values: [brandName] },
      ],
    });
    if (brandCharts[0]) return brandCharts[0];
  }
  const standardCharts = await api.searchSizeCharts(accessToken, {
    domainId: stripSitePrefix(domain),
    sellerId,
    type: "STANDARD",
    attributes: [{ id: "GENDER", values: [genderValueName] }],
  });
  return standardCharts[0];
}

async function resolveFootwearChart(
  accessToken: string,
  domain: string,
  sellerId: string,
  size: string,
  genderValueName: string,
  brandName: string | null,
): Promise<MercadoLivreAttributeCandidate[]> {
  const normalizedSize = normalizeFootwearSize(size);
  const chart = await findBrandOrStandardChart(accessToken, domain, sellerId, genderValueName, brandName);
  if (!chart) {
    throw new MarketplaceConnectorError(
      `Não há tabela de medidas (da marca ou padrão) para "${domain}" no Mercado Livre — não é possível publicar este calçado.`,
    );
  }

  const detail = await api.getSizeChart(accessToken, chart.id);
  const row = pickChartRow(detail.rows, [{ id: "SIZE", value: normalizedSize }]);
  if (!row) {
    // Lista os tamanhos reais da tabela — mesmo dado que a tela de revisão já mostra antes de
    // chegar aqui (achado real 24/09/2026); mantido também aqui como rede de segurança caso a
    // publicação seja chamada sem passar pela revisão.
    const available = availableSizeLabels(detail.rows);
    const suffix = available.length > 0 ? ` Tamanhos disponíveis: ${available.join(", ")}.` : "";
    throw new MarketplaceConnectorError(`A tabela de medidas do Mercado Livre não tem o tamanho "${normalizedSize}" para "${domain}".${suffix}`);
  }
  return sizeChartAttributes(normalizedSize, chart.id, row.id);
}

export interface MarketplaceSizeSuggestion {
  /** `false`: o domínio não usa tabela de medidas — a tela de revisão não precisa mostrar
   * seletor de tamanho nenhum. */
  applicable: boolean;
  /** Tamanhos já conhecidos do Mercado Livre pra essa marca/gênero: tabela `BRAND`/`STANDARD`
   * oficial, mais (só roupa, ADR-032) os tamanhos já usados na `SPECIFIC` do próprio vendedor,
   * se existir. Vazio quando nada disso existe ainda. */
  available: string[];
  /** Tamanho do cadastro (`tamanho_etiqueta`/`tamanho_equivalente`) — em calçado, já convertido
   * pro vocabulário do Mercado Livre; em roupa, o valor cru do cadastro. `null` se a peça não
   * tem tamanho cadastrado. */
  current: string | null;
  /** `true` quando `current` já está em `available` — a tela pode pré-selecionar e pular a
   * escolha manual. */
  currentMatches: boolean;
  /** `true` só pra roupa (ADR-024/ADR-032): sem nenhum tamanho em `available`, a tela não
   * bloqueia — deixa o operador digitar um tamanho, que vira uma linha nova na `SPECIFIC` do
   * vendedor. Calçado nunca cria tabela própria (ADR-024) — `available` vazio bloqueia mesmo. */
  allowCustomSize: boolean;
}

const NOT_APPLICABLE_SIZE_SUGGESTION: MarketplaceSizeSuggestion = {
  applicable: false,
  available: [],
  current: null,
  currentMatches: false,
  allowCustomSize: false,
};

/**
 * Sugestão de tamanho pra tela de revisão (spec 012; achado real 24/09/2026, calçado; e
 * 25/09/2026, roupa — ADR-032) — mesmo espírito de `suggestCategory`: só consulta, nunca
 * publica nada. Aplica a qualquer categoria de moda com tabela de medidas ativa, calçado ou
 * roupa — para roupa, existe mesmo quando a peça pode publicar sem escolher nada
 * (`allowCustomSize`), porque o valor cru do cadastro (`tamanho_etiqueta`) pode não ser um
 * `SIZE` válido pro Mercado Livre (achado real: `"FR 48 / US 19"` recusado como
 * `invalid_row_attribute_value`) — melhor a tela oferecer tamanhos já aceitos do que descobrir
 * o formato errado só depois de tentar publicar.
 */
export async function resolveSizeSuggestion(accessToken: string, product: Product, categoryId: string): Promise<MarketplaceSizeSuggestion> {
  const settings = await api.getCategory(accessToken, categoryId);
  if (!settings.catalogDomain) return NOT_APPLICABLE_SIZE_SUGGESTION;

  const activeDomains = await api.getActiveSizeChartDomains(accessToken);
  if (!activeDomains.includes(settings.catalogDomain)) return NOT_APPLICABLE_SIZE_SUGGESTION;

  const categoryAttributes = await api.getCategoryAttributes(accessToken, categoryId);
  const genderDef = categoryAttributes.find((a) => a.id === "GENDER");
  const gender = genderAttribute(product.caracteristicas.genero, product.classificacao.departamento, genderDef);
  // Sem gênero resolvido não dá pra buscar a tabela (mesma trava de `resolveSizeChartAttributes`)
  // — a revisão de gênero (cadastro) resolve isso antes de chegar aqui; não é responsabilidade
  // desta função duplicar aquele erro. `value_id` (não só `value_name`) é exigido porque a busca
  // de FILTRABLE_SIZE (ADR-033) precisa dele pra consultar `technical_specs`, mesma trava do
  // `resolveSizeChartAttributes` (publicação).
  if (!gender?.value_id || !gender.value_name) return NOT_APPLICABLE_SIZE_SUGGESTION;

  const currentUser = await mercadoLivreOAuthClient.fetchCurrentUser(accessToken);
  const sellerId = String(currentUser.id);

  if (product.classificacao.categoria_codigo === "SAPT") {
    const rawSize = product.caracteristicas.tamanho_etiqueta ?? product.caracteristicas.tamanho_equivalente;
    const current = rawSize ? normalizeFootwearSize(rawSize) : null;
    const chart = await findBrandOrStandardChart(accessToken, settings.catalogDomain, sellerId, gender.value_name, product.marca.nome);
    if (!chart) return { applicable: true, available: [], current, currentMatches: false, allowCustomSize: false };

    const detail = await api.getSizeChart(accessToken, chart.id);
    const available = availableSizeLabels(detail.rows);
    return { applicable: true, available, current, currentMatches: current !== null && available.includes(current), allowCustomSize: false };
  }

  // Roupa (ADR-032/033): junta a lista fechada de FILTRABLE_SIZE do domínio (achado real
  // 25/09/2026 — a fonte mais confiável, existe mesmo sem nenhuma tabela criada ainda) com os
  // tamanhos de uma tabela BRAND/STANDARD oficial (se existir, ADR-030) e os já usados na
  // SPECIFIC do próprio vendedor (se já existir uma pra esse domínio+gênero).
  const rawSize = product.caracteristicas.tamanho_etiqueta ?? product.caracteristicas.tamanho_equivalente;
  const current = rawSize ?? null;

  const officialChart = await findBrandOrStandardChart(accessToken, settings.catalogDomain, sellerId, gender.value_name, product.marca.nome);
  const specificCharts = await api.searchSizeCharts(accessToken, {
    domainId: stripSitePrefix(settings.catalogDomain),
    sellerId,
    type: "SPECIFIC",
    attributes: [{ id: "GENDER", values: [gender.value_name] }],
  });

  const charts = [officialChart, specificCharts[0]].filter((c): c is SizeChartSummary => c !== undefined);
  const rows = await Promise.all(charts.map((chart) => api.getSizeChart(accessToken, chart.id)));
  const chartAvailable = rows.flatMap((detail) => availableSizeLabels(detail.rows));

  const requiredSpecs = await api.getDomainSizeChartAttributes(accessToken, settings.catalogDomain, {
    valueId: gender.value_id,
    valueName: gender.value_name,
  });
  const filtrableSizeValues = requiredSpecs.find((spec) => spec.id === "FILTRABLE_SIZE")?.values.map((v) => v.name) ?? [];

  const available = [...new Set([...filtrableSizeValues, ...chartAvailable])];
  // Domínio com FILTRABLE_SIZE como lista fechada: só um valor dessa lista funciona — texto
  // livre fora dela sempre falha (achado real 25/09/2026), então não vale oferecer o campo.
  const allowCustomSize = filtrableSizeValues.length === 0;

  return { applicable: true, available, current, currentMatches: current !== null && available.includes(current), allowCustomSize };
}

export interface ShippingSuggestionOption {
  mode: string;
  logisticType: string;
  isDefault: boolean;
  /** `true` quando o Mercado Livre exige frete grátis nessa combinação (ex.: modo `me2`) — a
   * revisão não oferece escolha nesse caso, só informa. */
  freeShippingRequired: boolean;
  /** `false` quando o Mercado Livre não aceita frete grátis nessa combinação (ex.: modo `custom`
   * com custo declarado pelo vendedor). */
  freeShippingAllowed: boolean;
}

/**
 * Sugestão de frete pra tela de revisão (spec 012, achado real 24/09/2026) — mesmo espírito de
 * `resolveFootwearSizeSuggestion`: só consulta, nunca publica. Usa um subconjunto mais leve de
 * atributos (condição, marca, pacote) em vez de `buildAttributes` completo — não depende de
 * tamanho/GTIN/tabela de medidas, que não são relevantes pra elegibilidade de frete e podem não
 * estar resolvidos ainda nesse ponto da revisão.
 */
export async function resolveShippingSuggestion(
  accessToken: string,
  product: Product,
  categoryId: string,
  listingTypeId: string,
): Promise<ShippingSuggestionOption[]> {
  const price = product.preco.preco_venda;
  if (price === null) return [];

  const settings = await api.getCategory(accessToken, categoryId);
  if (!settings.catalogDomain) return [];

  const categoryAttributes = await api.getCategoryAttributes(accessToken, categoryId);
  const currentUser = await mercadoLivreOAuthClient.fetchCurrentUser(accessToken);
  const sellerId = String(currentUser.id);

  const itemConditionDef = categoryAttributes.find((a) => a.id === "ITEM_CONDITION");
  const candidates: MercadoLivreAttributeCandidate[] = [mapCondition(product.condicao.estado, itemConditionDef)];
  const brand = brandAttribute(product.marca.nome, categoryAttributes.some((a) => a.id === "BRAND"));
  if (brand) candidates.push(brand);
  const resolvedPackage = await resolvePackage(getDb(), product);
  candidates.push(...packageAttributes(resolvedPackage));
  const attributes = pickAttributes(candidates, categoryAttributes);

  const draftAttributes: api.ShippingDraftAttribute[] = attributes.map((a) => ({
    id: a.id,
    name: categoryAttributes.find((ca) => ca.id === a.id)?.name ?? a.id,
    valueId: a.value_id,
    valueName: a.value_name,
  }));

  const rawOptions = await api.getShippingModes(accessToken, {
    sellerId,
    title: product.identificacao.nome,
    itemPrice: price,
    categoryId,
    domainId: settings.catalogDomain,
    attributes: draftAttributes,
    listingTypeId,
    condition: topLevelCondition(product.condicao.estado),
  });

  return rawOptions.map((o) => ({
    mode: o.mode,
    logisticType: o.logisticType,
    isDefault: o.isDefault,
    freeShippingRequired: o.freeShipping === "mandatory" || o.freeShipping === "required",
    freeShippingAllowed: o.freeShipping !== "not_allowed",
  }));
}

/**
 * Critério de match da linha da tabela `SPECIFIC` — só `SIZE` (ADR-029). Antes matchava `SIZE` +
 * todos os `GARMENT_*` (ADR-024), uma linha por combinação de medida real (princípio X); erro
 * real ao vivo (25/09/2026, "Duplicated measure in attribute GARMENT_CHEST_WIDTH_FROM was found
 * in row SIZE 14") mostrou que o Mercado Livre recusa uma segunda linha com o mesmo `SIZE` e
 * medida diferente — `SIZE` é, na prática, a chave única de linha. Reaproveitar por `SIZE`
 * significa que o anúncio pode exibir a medida da primeira peça daquele tamanho publicada, não
 * necessariamente a desta peça — `product.medidas` no ERP continua com o valor real da peça,
 * só a representação no marketplace fica por tamanho, não por peça.
 */
async function resolveClothingChart(
  accessToken: string,
  domain: string,
  sellerId: string,
  size: string,
  genderValueName: string,
  garmentAttributes: MercadoLivreAttributeCandidate[],
  filtrableSize: { id: string; name: string } | undefined,
): Promise<MercadoLivreAttributeCandidate[]> {
  const criteria = [{ id: "SIZE", value: size }];

  const existingCharts = await api.searchSizeCharts(accessToken, {
    domainId: stripSitePrefix(domain),
    sellerId,
    type: "SPECIFIC",
    attributes: [{ id: "GENDER", values: [genderValueName] }],
  });

  let chartId: string;
  let row: SizeChartRow | null;

  if (existingCharts.length === 0) {
    const created = await api.createSizeChart(
      accessToken,
      buildChartPayload({
        name: buildChartName(domain, genderValueName),
        domainId: stripSitePrefix(domain),
        genderValueName,
        sizeLabel: size,
        garmentAttributes,
        filtrableSize,
      }),
    );
    chartId = created.id;
    const detail = await api.getSizeChart(accessToken, chartId);
    row = pickChartRow(detail.rows, criteria);
  } else {
    chartId = existingCharts[0]!.id;
    const detail = await api.getSizeChart(accessToken, chartId);
    row = pickChartRow(detail.rows, criteria);
    if (!row) {
      await api.addSizeChartRow(accessToken, chartId, buildChartRowPayload(size, garmentAttributes, filtrableSize));
      const refreshed = await api.getSizeChart(accessToken, chartId);
      row = pickChartRow(refreshed.rows, criteria);
    }
  }

  if (!row) {
    throw new MarketplaceConnectorError("Falha ao localizar a linha da tabela de medidas depois de criá-la — tente publicar de novo.");
  }
  return sizeChartAttributes(size, chartId, row.id);
}
