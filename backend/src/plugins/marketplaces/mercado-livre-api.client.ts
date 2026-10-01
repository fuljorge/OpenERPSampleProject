/**
 * Cliente HTTP da API de itens/categorias/tabelas de medidas do Mercado Livre (spec 012, seções
 * 3–7) — fronteira de rede isolada, substituível em testes (nenhum teste chama o Mercado Livre de
 * verdade). Diferente de `mercado-livre-oauth.client.ts` (troca de tokens), este fala com `/items`,
 * `/categories`, `/domains` e `/catalog/charts`, sempre com o `access_token` de uma conta.
 *
 * Nunca inclui token, `client_secret` ou credencial em mensagens de erro (spec 011, seção 3).
 */

const DEFAULT_BASE_URL = "https://api.mercadolibre.com";
const REQUEST_TIMEOUT_MS = 15_000;
const SITE_ID = "MLB";
/** `409` de versão no encerramento é o único caso com repetição automática (spec 012, seção 7). */
const CLOSE_RETRY_ATTEMPTS = 3;
const CLOSE_RETRY_DELAY_MS = 1_000;

/**
 * `MERCADO_LIVRE_API_BASE_URL` só vale fora de produção (E2E com servidor falso) — um valor errado
 * em produção desviaria chamadas com token real para outro host. Lida a cada chamada, nunca
 * congelada no carregamento do módulo.
 */
function resolveBaseUrl(): string {
  const override = process.env.MERCADO_LIVRE_API_BASE_URL;
  if (override && process.env.NODE_ENV !== "production") return override;
  return DEFAULT_BASE_URL;
}

export interface MercadoLivreCause {
  department?: string;
  causeId?: number;
  type?: string;
  code?: string;
  references?: string[];
  message: string;
}

export interface MercadoLivreWarning {
  code: string | undefined;
  message: string;
}

export class MercadoLivreApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly causes: MercadoLivreCause[];

  constructor(message: string, status: number, code: string | undefined, causes: MercadoLivreCause[] = []) {
    super(message);
    this.name = "MercadoLivreApiError";
    this.status = status;
    this.code = code;
    this.causes = causes;
  }

  /** Algum código de erro específico entre as causas (ex.: `item.attribute.missing_conditional_required`). */
  hasCauseCode(code: string): boolean {
    return this.code === code || this.causes.some((cause) => cause.code === code);
  }
}

function normalizeCause(raw: unknown): MercadoLivreCause {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    department: typeof r.department === "string" ? r.department : undefined,
    causeId: typeof r.cause_id === "number" ? r.cause_id : undefined,
    type: typeof r.type === "string" ? r.type : undefined,
    code: typeof r.code === "string" ? r.code : undefined,
    references: Array.isArray(r.references) ? r.references.filter((x): x is string => typeof x === "string") : undefined,
    message: typeof r.message === "string" ? r.message : "Erro não detalhado do Mercado Livre.",
  };
}

function normalizeWarning(raw: unknown): MercadoLivreWarning {
  const r = (raw ?? {}) as Record<string, unknown>;
  const code = typeof r.code === "string" ? r.code : undefined;
  const message = typeof r.message === "string" ? r.message : (code ?? "Aviso não detalhado do Mercado Livre.");
  return { code, message };
}

interface RawErrorBody {
  message?: string;
  error?: string;
  cause?: unknown[];
  /**
   * Formato alternativo, sem `type` (warning/error) — visto em `POST /catalog/charts` (spec 012,
   * seção 3.6 só documentava `cause`; confirmado ao vivo no T043). Toda entrada aqui é tratada como
   * bloqueante — não há como distinguir aviso de erro nesse formato.
   */
  errors?: unknown[];
}

export interface MercadoLivreApiResult<T> {
  body: T;
  /** `warnings` da resposta de sucesso (spec 012, seção 3.1/3.6) — lido de forma defensiva. */
  warnings: MercadoLivreWarning[];
}

async function request<T>(
  path: string,
  accessToken: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined>; headers?: Record<string, string> } = {},
): Promise<MercadoLivreApiResult<T>> {
  const url = new URL(resolveBaseUrl() + path);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new MercadoLivreApiError("Não foi possível falar com o Mercado Livre. Tente de novo em instantes.", 0, undefined);
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const body = parsed as RawErrorBody | null;
    // `cause` às vezes não é array (visto ao vivo, T043 — item removido do Mercado Livre devolveu
    // um formato de erro diferente) — `?? []` sozinho não protege contra um valor truthy não-array.
    const causes = Array.isArray(body?.cause) ? body.cause.map(normalizeCause) : [];
    const errorCauses = causes.filter((cause) => cause.type === "error");
    const altErrors = Array.isArray(body?.errors) ? body.errors.map(normalizeCause) : [];
    const blockingMessages = [...errorCauses, ...altErrors].map((c) => c.message);
    const message =
      blockingMessages.length > 0
        ? blockingMessages.join(" ")
        : (body?.message ?? `O Mercado Livre recusou a requisição (HTTP ${response.status}).`);
    throw new MercadoLivreApiError(message, response.status, body?.error ?? errorCauses[0]?.code ?? altErrors[0]?.code, [...causes, ...altErrors]);
  }

  const bodyRecord = parsed as { warnings?: unknown[] } | null;
  const warnings = Array.isArray(bodyRecord?.warnings) ? bodyRecord.warnings.map(normalizeWarning) : [];
  return { body: parsed as T, warnings };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Categorização (spec 012, seção 4)

export interface CategoryPrediction {
  domainId: string;
  domainName: string;
  categoryId: string;
  categoryName: string;
  attributes: { id: string; valueId: string | undefined; valueName: string }[];
}

export async function predictCategory(accessToken: string, query: string): Promise<CategoryPrediction | null> {
  const { body } = await request<unknown>(`/sites/${SITE_ID}/domain_discovery/search`, accessToken, {
    query: { limit: "1", q: query },
  });
  const first = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined;
  if (!first || typeof first.category_id !== "string" || typeof first.domain_id !== "string") return null;

  return {
    domainId: first.domain_id,
    domainName: typeof first.domain_name === "string" ? first.domain_name : first.domain_id,
    categoryId: first.category_id,
    categoryName: typeof first.category_name === "string" ? first.category_name : first.category_id,
    attributes: Array.isArray(first.attributes)
      ? (first.attributes as Record<string, unknown>[]).map((a) => ({
          id: String(a.id),
          valueId: typeof a.value_id === "string" ? a.value_id : undefined,
          valueName: typeof a.value_name === "string" ? a.value_name : "",
        }))
      : [],
  };
}

export interface CategorySettings {
  maxTitleLength: number | undefined;
  minimumPrice: number | null;
  maximumPrice: number | null;
  maxPicturesPerItem: number | undefined;
  maxDescriptionLength: number | undefined;
  immediatePayment: string | undefined;
  listingAllowed: boolean;
  status: string | undefined;
  /** `settings.catalog_domain` (ex.: `"MLB-SHIRTS"`) — domínio da categoria, usado na moda (seção 3.5). */
  catalogDomain: string | undefined;
}

export async function getCategory(accessToken: string, categoryId: string): Promise<CategorySettings> {
  const { body } = await request<{ settings?: Record<string, unknown> }>(`/categories/${categoryId}`, accessToken);
  const s = body.settings ?? {};
  return {
    maxTitleLength: typeof s.max_title_length === "number" ? s.max_title_length : undefined,
    minimumPrice: typeof s.minimum_price === "number" ? s.minimum_price : null,
    maximumPrice: typeof s.maximum_price === "number" ? s.maximum_price : null,
    maxPicturesPerItem: typeof s.max_pictures_per_item === "number" ? s.max_pictures_per_item : undefined,
    maxDescriptionLength: typeof s.max_description_length === "number" ? s.max_description_length : undefined,
    immediatePayment: typeof s.immediate_payment === "string" ? s.immediate_payment : undefined,
    listingAllowed: s.listing_allowed !== false,
    status: typeof s.status === "string" ? s.status : undefined,
    catalogDomain: typeof s.catalog_domain === "string" ? s.catalog_domain : undefined,
  };
}

export interface AttributeTags {
  required: boolean;
  newRequired: boolean;
  conditionalRequired: boolean;
  readOnly: boolean;
  fixed: boolean;
  inferred: boolean;
  hidden: boolean;
  multivalued: boolean;
  gridFilter: boolean;
  gridTemplateRequired: boolean;
}

export interface CategoryAttribute {
  id: string;
  name: string;
  valueType: string | undefined;
  tags: AttributeTags;
  values: { id: string; name: string }[];
}

function parseTags(raw: unknown): AttributeTags {
  const t = (raw ?? {}) as Record<string, unknown>;
  const flag = (key: string) => t[key] === true;
  return {
    required: flag("required"),
    newRequired: flag("new_required"),
    conditionalRequired: flag("conditional_required"),
    readOnly: flag("read_only"),
    fixed: flag("fixed"),
    inferred: flag("inferred"),
    hidden: flag("hidden"),
    multivalued: flag("multivalued"),
    gridFilter: flag("grid_filter"),
    gridTemplateRequired: flag("grid_template_required"),
  };
}

function parseAttribute(raw: Record<string, unknown>): CategoryAttribute {
  return {
    id: String(raw.id),
    name: typeof raw.name === "string" ? raw.name : String(raw.id),
    valueType: typeof raw.value_type === "string" ? raw.value_type : undefined,
    tags: parseTags(raw.tags),
    values: Array.isArray(raw.values)
      ? (raw.values as Record<string, unknown>[]).map((v) => ({ id: String(v.id), name: String(v.name ?? "") }))
      : [],
  };
}

export async function getCategoryAttributes(accessToken: string, categoryId: string): Promise<CategoryAttribute[]> {
  const { body } = await request<unknown[]>(`/categories/${categoryId}/attributes`, accessToken);
  return Array.isArray(body) ? body.map((a) => parseAttribute(a as Record<string, unknown>)) : [];
}

/** `POST /categories/{id}/attributes/conditional` — quais `conditional_required` de fato se aplicam a este item. */
export async function getConditionallyRequiredAttributes(
  accessToken: string,
  categoryId: string,
  itemDraft: Record<string, unknown>,
): Promise<string[]> {
  const { body } = await request<{ required_attributes?: { id: string }[] }>(
    `/categories/${categoryId}/attributes/conditional`,
    accessToken,
    { method: "POST", body: itemDraft },
  );
  return (body.required_attributes ?? []).map((a) => a.id);
}

// ---------------------------------------------------------------------------------------------
// Itens (spec 012, seções 3, 3.1, 7)

export interface MercadoLivreItemSummary {
  id: string;
  status: string;
  soldQuantity: number;
  categoryId: string;
  permalink: string | undefined;
}

function parseItemSummary(raw: Record<string, unknown>): MercadoLivreItemSummary {
  return {
    id: String(raw.id),
    status: typeof raw.status === "string" ? raw.status : "",
    soldQuantity: typeof raw.sold_quantity === "number" ? raw.sold_quantity : 0,
    categoryId: typeof raw.category_id === "string" ? raw.category_id : "",
    permalink: typeof raw.permalink === "string" ? raw.permalink : undefined,
  };
}

export interface CreateOrUpdateItemResult {
  id: string;
  permalink: string | undefined;
  status: string;
  warnings: MercadoLivreWarning[];
}

export async function createItem(accessToken: string, payload: Record<string, unknown>): Promise<CreateOrUpdateItemResult> {
  const { body, warnings } = await request<Record<string, unknown>>("/items", accessToken, { method: "POST", body: payload });
  return {
    id: String(body.id),
    permalink: typeof body.permalink === "string" ? body.permalink : undefined,
    status: typeof body.status === "string" ? body.status : "",
    warnings,
  };
}

export async function updateItem(
  accessToken: string,
  itemId: string,
  payload: Record<string, unknown>,
): Promise<CreateOrUpdateItemResult> {
  const { body, warnings } = await request<Record<string, unknown>>(`/items/${itemId}`, accessToken, {
    method: "PUT",
    body: payload,
  });
  return {
    id: String(body.id),
    permalink: typeof body.permalink === "string" ? body.permalink : undefined,
    status: typeof body.status === "string" ? body.status : "",
    warnings,
  };
}

export async function getItem(accessToken: string, itemId: string): Promise<MercadoLivreItemSummary> {
  const { body } = await request<Record<string, unknown>>(`/items/${itemId}`, accessToken);
  return parseItemSummary(body);
}

/** `GET /items?ids=…` (multiget, até 20 ids) — itens não encontrados/sem permissão são omitidos, não lançam. */
export async function getItemsByIds(accessToken: string, ids: string[]): Promise<MercadoLivreItemSummary[]> {
  if (ids.length === 0) return [];
  const { body } = await request<unknown[]>("/items", accessToken, {
    query: { ids: ids.join(","), attributes: "id,status,permalink,sold_quantity,category_id" },
  });
  if (!Array.isArray(body)) return [];
  return body
    .filter((entry) => (entry as Record<string, unknown>).code === 200)
    .map((entry) => parseItemSummary((entry as Record<string, unknown>).body as Record<string, unknown>));
}

export async function createDescription(accessToken: string, itemId: string, plainText: string): Promise<void> {
  await request(`/items/${itemId}/description`, accessToken, { method: "POST", body: { plain_text: plainText } });
}

export async function updateDescription(accessToken: string, itemId: string, plainText: string): Promise<void> {
  await request(`/items/${itemId}/description`, accessToken, {
    method: "PUT",
    body: { plain_text: plainText },
    query: { api_version: "2" },
  });
}

/** `GET /users/{sellerId}/items/search?seller_sku=` (spec 012, seção 3.1) — ids, mais recentes primeiro. */
export async function searchItemsBySellerSku(accessToken: string, sellerId: string, sku: string): Promise<string[]> {
  const { body } = await request<{ results?: unknown[] }>(`/users/${sellerId}/items/search`, accessToken, {
    query: { seller_sku: sku, orders: "start_time_desc" },
  });
  return Array.isArray(body.results) ? body.results.filter((id): id is string => typeof id === "string") : [];
}

export interface CloseItemResult {
  alreadyClosed: boolean;
}

/**
 * Encerra o anúncio (spec 012, seção 7): idempotente — item já `closed` é sucesso, sem `PUT`.
 * `409` de versão é repetido até `CLOSE_RETRY_ATTEMPTS` vezes antes de falhar.
 */
export async function closeItem(accessToken: string, itemId: string): Promise<CloseItemResult> {
  const current = await getItem(accessToken, itemId);
  if (current.status === "closed") return { alreadyClosed: true };

  let lastError: MercadoLivreApiError | undefined;
  for (let attempt = 1; attempt <= CLOSE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await request(`/items/${itemId}`, accessToken, { method: "PUT", body: { status: "closed" } });
      return { alreadyClosed: false };
    } catch (err) {
      if (!(err instanceof MercadoLivreApiError) || err.status !== 409) throw err;
      lastError = err;
      if (attempt < CLOSE_RETRY_ATTEMPTS) await sleep(CLOSE_RETRY_DELAY_MS);
    }
  }
  throw lastError ?? new MercadoLivreApiError("Falha ao encerrar o anúncio.", 409, undefined);
}

// ---------------------------------------------------------------------------------------------
// Tabela de medidas (spec 012, seção 3.5; ADR-024)

export async function getActiveSizeChartDomains(accessToken: string): Promise<string[]> {
  try {
    const { body } = await request<{ domains?: { domain_id: string }[] }>(
      `/catalog/charts/${SITE_ID}/configurations/active_domains`,
      accessToken,
    );
    return (body.domains ?? []).map((d) => d.domain_id);
  } catch (err) {
    if (err instanceof MercadoLivreApiError && err.status === 404) return [];
    throw err;
  }
}

export interface TechnicalSpecAttribute {
  id: string;
  name: string;
  valueType: string | undefined;
  tags: string[];
  /** Valores aceitos pra atributos de lista fechada (ex.: `FILTRABLE_SIZE`) — vazio pra
   * atributos de texto livre (`SIZE`, `GARMENT_*`), que não têm essa restrição. */
  values: { id: string; name: string }[];
}

/**
 * `POST /domains/{id}/technical_specs?section=grids` — atributos do "grid template" do domínio
 * **para um gênero específico** (ex.: `BRAND`, `GENDER`, `AGE_GROUP`, `GARMENT_*` — os
 * filtros/medidas da tabela). Estrutura real (T043, 22/09/2026, confirmada ao vivo):
 * `input.groups[].components[].components[].attributes[]` — dois níveis de `components`
 * aninhados (o de fora é a seção, ex. "GRID"; o de dentro é cada campo).
 *
 * **T060 (23/09/2026, resolvida via documentação oficial):** a causa real de `GARMENT_*` nunca
 * aparecer era chamar isto como `GET` sem corpo — os atributos `GARMENT_*` têm
 * `hierarchy: "CHILD_DEPENDENT"` (dependem do `GENDER` escolhido: um casaco masculino e um
 * feminino pedem medidas diferentes) e só aparecem numa consulta **`POST`** informando o
 * `GENDER` já resolvido no corpo — doc oficial ("Check the product specification sheet of the
 * size chart", developers.mercadolibre.com.ar/en_us/first-steps-mkt). Sem o `GENDER` no corpo, a
 * resposta é a ficha genérica do domínio, sem as medidas específicas daquele gênero.
 */
export async function getDomainSizeChartAttributes(
  accessToken: string,
  domainId: string,
  genderAttribute: { valueId: string; valueName: string },
): Promise<TechnicalSpecAttribute[]> {
  const { body } = await request<{ input?: { groups?: { components?: Record<string, unknown>[] }[] } }>(
    `/domains/${domainId}/technical_specs`,
    accessToken,
    {
      method: "POST",
      query: { section: "grids" },
      body: {
        attributes: [
          {
            id: "GENDER",
            name: "Gênero",
            value_id: genderAttribute.valueId,
            value_name: genderAttribute.valueName,
            values: [{ id: genderAttribute.valueId, name: genderAttribute.valueName }],
          },
        ],
      },
    },
  );
  const groups = body.input?.groups ?? [];
  const attributes: TechnicalSpecAttribute[] = [];
  for (const group of groups) {
    for (const outerComponent of group.components ?? []) {
      const innerComponents = Array.isArray(outerComponent.components) ? (outerComponent.components as Record<string, unknown>[]) : [];
      for (const component of innerComponents) {
        const raw = component.attributes;
        if (!Array.isArray(raw)) continue;
        for (const a of raw as Record<string, unknown>[]) {
          attributes.push({
            id: String(a.id),
            name: typeof a.name === "string" ? a.name : String(a.id),
            valueType: typeof a.value_type === "string" ? a.value_type : undefined,
            tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === "string") : [],
            values: Array.isArray(a.values)
              ? (a.values as Record<string, unknown>[]).map((v) => ({ id: String(v.id ?? ""), name: String(v.name ?? v.id ?? "") }))
              : [],
          });
        }
      }
    }
  }
  return attributes;
}

export interface SizeChartAttributeFilter {
  id: string;
  values: string[];
}

export interface SizeChartSummary {
  id: string;
  type: string;
  mainAttributeId: string | undefined;
}

/** `POST /catalog/charts/search` — tabelas sugeridas (spec 012, seção 3.5). */
export async function searchSizeCharts(
  accessToken: string,
  input: { domainId: string; sellerId: string; type?: "STANDARD" | "BRAND" | "SPECIFIC"; attributes: SizeChartAttributeFilter[] },
): Promise<SizeChartSummary[]> {
  const { body } = await request<{ charts?: Record<string, unknown>[] }>("/catalog/charts/search", accessToken, {
    method: "POST",
    query: { offset: "0", limit: "100" },
    body: {
      domain_id: input.domainId,
      site_id: SITE_ID,
      seller_id: input.sellerId,
      ...(input.type ? { type: input.type } : {}),
      attributes: input.attributes.map((a) => ({ id: a.id, values: a.values.map((name) => ({ name })) })),
    },
  });
  return (body.charts ?? []).map((c) => ({
    id: String(c.id),
    type: typeof c.type === "string" ? c.type : "",
    mainAttributeId: typeof c.main_attribute_id === "string" ? c.main_attribute_id : undefined,
  }));
}

export interface SizeChartRow {
  id: string;
  attributes: { id: string; values: string[] }[];
}

export interface SizeChartDetail {
  id: string;
  type: string;
  rows: SizeChartRow[];
}

function parseChartRow(raw: Record<string, unknown>): SizeChartRow {
  const attrs = Array.isArray(raw.attributes) ? (raw.attributes as Record<string, unknown>[]) : [];
  return {
    id: String(raw.id),
    attributes: attrs.map((a) => ({
      id: String(a.id),
      values: Array.isArray(a.values)
        ? (a.values as Record<string, unknown>[]).map((v) => String(v.name ?? "")).filter(Boolean)
        : [],
    })),
  };
}

export async function getSizeChart(accessToken: string, chartId: string): Promise<SizeChartDetail> {
  const { body } = await request<Record<string, unknown>>(`/catalog/charts/${chartId}`, accessToken);
  const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [];
  return { id: String(body.id), type: typeof body.type === "string" ? body.type : "", rows: rows.map(parseChartRow) };
}

/**
 * Valor de um atributo de linha — string pra atributos de texto livre (`SIZE`, `GARMENT_*`), ou
 * `{ id, name }` pra atributos de lista fechada como `FILTRABLE_SIZE` (achado real ao vivo,
 * 25/09/2026: `"Value 48 in attribute FILTRABLE_SIZE is incorrect"`, mesmo com um valor "limpo"
 * — a doc oficial de `size-guide-validations` confirma que atributos de lista exigem o `id` do
 * valor, obtido de `technical_specs?section=grids`; mandar só `{ name }` é o que causava o erro
 * — nunca funcionou pra `FILTRABLE_SIZE`, só "por acaso" não dava erro quando o `id` não era
 * checado por algum domínio específico).
 */
export type SizeChartRowValue = string | { id: string; name: string };

function serializeRowValue(value: SizeChartRowValue): { id?: string; name: string } {
  return typeof value === "string" ? { name: value } : { id: value.id, name: value.name };
}

export interface CreateSizeChartRowInput {
  attributes: { id: string; values: SizeChartRowValue[] }[];
}

export interface CreateSizeChartInput {
  /** ≤ 60 caracteres, só letras/números/espaços — gerado pelo conector, nunca digitado (spec 012, seção 3.5). */
  name: string;
  domainId: string;
  measureType: "CLOTHING_MEASURE";
  attributes: SizeChartAttributeFilter[];
  mainAttributeId: string;
  firstRow: CreateSizeChartRowInput;
}

/** `POST /catalog/charts` — cria a tabela `SPECIFIC` com a primeira linha (spec 012, seção 3.5; ADR-024). */
export async function createSizeChart(accessToken: string, input: CreateSizeChartInput): Promise<{ id: string }> {
  const { body } = await request<{ id: string }>("/catalog/charts", accessToken, {
    method: "POST",
    body: {
      names: { [SITE_ID]: input.name },
      domain_id: input.domainId,
      site_id: SITE_ID,
      measure_type: input.measureType,
      attributes: input.attributes.map((a) => ({ id: a.id, values: a.values.map((name) => ({ name })) })),
      main_attribute: { attributes: [{ site_id: SITE_ID, id: input.mainAttributeId }] },
      rows: [{ attributes: input.firstRow.attributes.map((a) => ({ id: a.id, values: a.values.map(serializeRowValue) })) }],
    },
  });
  return { id: String(body.id) };
}

/** `POST /catalog/charts/{id}/rows` — adiciona uma linha a uma tabela `SPECIFIC` já existente. */
export async function addSizeChartRow(accessToken: string, chartId: string, row: CreateSizeChartRowInput): Promise<void> {
  await request(`/catalog/charts/${chartId}/rows`, accessToken, {
    method: "POST",
    body: { attributes: row.attributes.map((a) => ({ id: a.id, values: a.values.map(serializeRowValue) })) },
  });
}

// ---------------------------------------------------------------------------------------------
// Frete (spec 012, achado real 24/09/2026)

/** Um `attributes[]` do rascunho de item para `getShippingModes` — inclui `name` (a doc mostra
 * o atributo completo, não só id/valor como o resto do conector usa). */
export interface ShippingDraftAttribute {
  id: string;
  name: string;
  valueId?: string;
  valueName?: string;
}

export interface GetShippingModesInput {
  sellerId: string;
  title: string;
  itemPrice: number;
  categoryId: string;
  domainId: string;
  attributes: ShippingDraftAttribute[];
  listingTypeId: string;
  /** `"new" | "used"` — vocabulário do campo `condition` de `POST /items`, diferente do valor
   * localizado do atributo `ITEM_CONDITION` (`mapCondition`). */
  condition: "new" | "used";
}

/**
 * Requisito de frete grátis/custos por combinação de modo+tipo de logística — vocabulário cru
 * do Mercado Livre (`"mandatory"`, `"required"`, `"optional"`, `"not_allowed"`, `"not_required"`,
 * `"clear"` já confirmados em exemplos oficiais diferentes; nunca normalizado aqui, pra nunca
 * inventar um significado pra um valor que ainda não apareceu contra a API real).
 */
export interface ShippingModeOption {
  mode: string;
  logisticType: string;
  isDefault: boolean;
  freeShipping: string;
  costs: string;
  localPickUp: string;
}

/**
 * `POST /users/{sellerId}/shipping_modes` — combinações de frete (modo + tipo de logística)
 * realmente válidas para um rascunho de item, **antes** de publicar (spec 012, achado real
 * 24/09/2026: publicar sem declarar frete deixa o Mercado Livre aplicar um padrão próprio, que
 * pode conflitar com o que a conta tem habilitado). Documentação oficial consistente em
 * en_us/es_ar, mas com o exemplo de `curl` malformado nas duas (sem `-H` nos headers extras,
 * sem corpo) — o formato do corpo abaixo segue o JSON de exemplo (que está completo), não o
 * `curl`. **Ainda não confirmado contra a API real** (sem token de acesso válido neste ambiente
 * de execução).
 */
export async function getShippingModes(accessToken: string, input: GetShippingModesInput): Promise<ShippingModeOption[]> {
  const { body } = await request<{ channels?: { marketplace?: { available_modes?: unknown[] } } }>(
    `/users/${input.sellerId}/shipping_modes`,
    accessToken,
    {
      method: "POST",
      headers: { "x-multichannel": "true", "X-Format-New": "true" },
      body: {
        site_id: SITE_ID,
        seller_id: Number(input.sellerId),
        title: input.title,
        item_price: input.itemPrice,
        item_currency: "BRL",
        category_id: input.categoryId,
        catalog: {
          domain_id: input.domainId,
          attributes: input.attributes.map((a) => ({
            id: a.id,
            name: a.name,
            ...(a.valueName !== undefined ? { value_name: a.valueName } : {}),
            ...(a.valueId !== undefined ? { value_id: a.valueId } : {}),
          })),
        },
        sale_terms: [],
        listing_type_id: input.listingTypeId,
        buying_mode: "buy_it_now",
        condition: input.condition,
        channels: [{ id: "marketplace" }],
        new_format: true,
        verbose: false,
      },
    },
  );

  const availableModes = body.channels?.marketplace?.available_modes ?? [];
  const options: ShippingModeOption[] = [];
  for (const raw of availableModes) {
    const m = raw as Record<string, unknown>;
    const mode = typeof m.mode === "string" ? m.mode : undefined;
    const logisticTypes = Array.isArray(m.logistic_types) ? (m.logistic_types as Record<string, unknown>[]) : [];
    if (!mode) continue;
    for (const lt of logisticTypes) {
      const type = typeof lt.type === "string" ? lt.type : undefined;
      const attrs = (lt.attributes ?? {}) as Record<string, unknown>;
      if (!type) continue;
      options.push({
        mode,
        logisticType: type,
        isDefault: lt.default === true,
        freeShipping: typeof attrs.free_shipping === "string" ? attrs.free_shipping : "optional",
        costs: typeof attrs.costs === "string" ? attrs.costs : "not_allowed",
        localPickUp: typeof attrs.local_pick_up === "string" ? attrs.local_pick_up : "not_allowed",
      });
    }
  }
  return options;
}
