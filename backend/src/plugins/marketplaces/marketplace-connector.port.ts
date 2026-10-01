import type { Product } from "../../schemas/product.schema.js";
import type { MarketplaceAccount } from "../../schemas/marketplace-account.schema.js";
import type { MarketplaceListing } from "../../../../shared/dist/schemas/marketplace.schema.js";

/**
 * Porta de abstração de conectores de marketplace (constituição, princípio VI; spec 011,
 * seção 4.1 e 4.7; spec 012, seções 2.3, 3.1 e 7). Nenhuma camada de domínio ou serviço deve
 * conhecer o SDK/API de um marketplace concreto — apenas este contrato. Superfície mínima,
 * deliberada (mesmo espírito da spec 006, seção 8.2, defesa E): criar/atualizar e encerrar um
 * anúncio, nenhuma capacidade de function/tool calling ou ação autônoma além disso.
 *
 * O adaptador **nunca** toca no MongoDB nem guarda estado por conta (ADR-023): quando renova um
 * token, devolve o par novo em `updatedCredential` — no resultado **e** no erro — e quem grava é o
 * serviço. Perder o par novo deixaria a conta permanentemente expirada (o `refresh_token` do
 * Mercado Livre é de uso único).
 */

/** Conta como o conector a vê — sem o `publishedListingsCount`, que é só de apresentação. */
export type ConnectorAccount = Omit<MarketplaceAccount, "publishedListingsCount">;

/** O que toda operação recebe: a conta e a credencial **já decifrada**, só em memória. */
export interface ConnectorContext {
  account: ConnectorAccount;
  /** Nunca é logada pelo adaptador nem incluída em mensagem de erro (spec 011, seção 3). */
  credential: string;
}

export interface PublishInput extends ConnectorContext {
  product: Product;
  /**
   * Entrada atual de `products.marketplaces[]` para esta conta, se existir. É o `id_anuncio` dela
   * (e não o `status`) que decide entre criar e atualizar (spec 012, seção 3.1).
   */
  listing: MarketplaceListing | null;
  /**
   * Categoria já escolhida antes de chamar a porta (spec 011, seção 4.1; ADR-025) — nenhum
   * adaptador decide sozinho em qual categoria publicar. Hoje só o Mercado Livre usa o campo
   * (revisão obrigatória do operador, spec 012, seção 4); um conector futuro sem esse passo o
   * ignora.
   */
  categoryId?: string | null;
  /**
   * Tipo/plano de anúncio já escolhido pelo operador (spec 011, seção 4.1; ADR-026) — mesmo
   * espírito de `categoryId`: nenhum adaptador decide sozinho, nunca uma variável de ambiente
   * fixa. Hoje só o Mercado Livre usa o campo (caixa de seleção na revisão, spec 012, seção 3.2).
   */
  listingTypeId?: string | null;
  /**
   * Tamanho de calçado escolhido pelo operador na revisão (spec 012, achado real 24/09/2026) —
   * só quando o `tamanho_etiqueta` do cadastro não bate com nenhuma linha da tabela `BRAND`/
   * `STANDARD` do Mercado Livre (tabela fixa, o ERP não pode criar linha nova nela, diferente da
   * `SPECIFIC` de roupa). Tem prioridade sobre o cadastro só pra esta publicação; nunca é
   * gravado de volta no produto. Hoje só o Mercado Livre usa o campo, mesmo espírito de
   * `categoryId`/`listingTypeId`.
   */
  sizeOverride?: string | null;
  /**
   * Frete escolhido pelo operador na revisão (spec 012, achado real 24/09/2026) — publicar sem
   * declarar `shipping` deixa o Mercado Livre aplicar um padrão próprio, que pode conflitar com
   * o que a conta tem habilitado (achado real: aviso sobre o modo `me1` não estar ativado numa
   * conta que nunca configurou frete nenhum explicitamente). Hoje só o Mercado Livre usa o
   * campo, mesmo espírito de `categoryId`/`listingTypeId`/`sizeOverride`.
   */
  shipping?: { mode: string; logisticType: string; freeShipping: boolean } | null;
  /**
   * Atributos obrigatórios da categoria que o cadastro não cobre ("tipo de roupa", "tipo de
   * manga"...), escolhidos pelo operador na revisão (ADR-035). Só pra esta publicação, nunca
   * gravados no produto. Hoje só o Mercado Livre usa o campo.
   */
  extraAttributes?: { id: string; valueId?: string | null; valueName: string }[] | null;
}

export interface CloseInput extends ConnectorContext {
  listing: MarketplaceListing;
}

export interface MarketplacePublishResult {
  id_anuncio: string;
  url_anuncio: string;
  /**
   * Pendência com o anúncio já no ar (ex.: descrição não enviada, preço ignorado) — vira `erro`
   * junto de `status = publicado` (spec 012, seção 3.1). `null` = tudo certo.
   */
  pendencia: string | null;
}

export interface MarketplaceCloseResult {
  encerrado: true;
}

export interface ConnectorOutcome<T> {
  value: T;
  /** Credencial nova (JSON já serializado, ainda **sem** cifrar) se o conector precisou renová-la. */
  updatedCredential?: string;
}

/**
 * Falha de uma operação do conector. A mensagem descreve o tipo do problema e **nunca** o valor de
 * credencial, token ou segredo (spec 011, seção 3).
 */
export class MarketplaceConnectorError extends Error {
  /** Presente se houve renovação de token antes da falha — o serviço deve gravá-la mesmo assim. */
  readonly updatedCredential: string | undefined;
  /** `true` → a conta precisa ser reconectada pelo OAuth (o serviço a marca como `expired`). */
  readonly reconnectRequired: boolean;

  constructor(message: string, options: { updatedCredential?: string; reconnectRequired?: boolean } = {}) {
    super(message);
    this.name = "MarketplaceConnectorError";
    this.updatedCredential = options.updatedCredential;
    this.reconnectRequired = options.reconnectRequired ?? false;
  }
}

export interface MarketplaceConnectorPort {
  /**
   * Cria o anúncio, ou o atualiza se `listing.id_anuncio` já existe (spec 012, seção 3.1). Falhas
   * lançam `MarketplaceConnectorError` (ou qualquer `Error`, tratado como falha sem token novo).
   */
  publish(input: PublishInput): Promise<ConnectorOutcome<MarketplacePublishResult>>;

  /** Encerra o anúncio (spec 011, seção 4.7). Idempotente: item já encerrado é sucesso. */
  close(input: CloseInput): Promise<ConnectorOutcome<MarketplaceCloseResult>>;
}
