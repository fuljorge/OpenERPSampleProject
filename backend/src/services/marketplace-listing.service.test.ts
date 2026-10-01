import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../schemas/product.schema.js";
import type { MarketplaceListing } from "../../../shared/dist/schemas/marketplace.schema.js";
import type { MarketplaceAccountRecord } from "../repositories/marketplace-account.repository.js";

const getProductByIdMock = vi.fn();
const findByIdMock = vi.fn();
const upsertListingMock = vi.fn();
const recordMock = vi.fn();
const runAccountOperationMock = vi.fn();
const publishMock = vi.fn();
const closeMock = vi.fn();

vi.mock("./product.service.js", () => ({
  getProductById: (...args: unknown[]) => getProductByIdMock(...args),
}));

vi.mock("../repositories/marketplace-account.repository.js", () => ({
  marketplaceAccountRepository: { findById: (...args: unknown[]) => findByIdMock(...args) },
}));

vi.mock("../repositories/product.repository.js", () => ({
  productRepository: {
    upsertMarketplaceListing: (...args: unknown[]) => upsertListingMock(...args),
  },
}));

vi.mock("./audit-log.service.js", () => ({
  record: (...args: unknown[]) => recordMock(...args),
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

// `runAccountOperation` fica mockado, mas as demais exportações (AccountBusyError) são as reais —
// os testes usam `instanceof` contra a mesma classe que o serviço sob teste importa.
vi.mock("./account-operation.service.js", async () => {
  const actual = await vi.importActual<typeof import("./account-operation.service.js")>("./account-operation.service.js");
  return { ...actual, runAccountOperation: (...args: unknown[]) => runAccountOperationMock(...args) };
});

const {
  publishListing,
  closeListing,
  setMarketplaceConnectorForTesting,
  ProductMissingRequiredFieldsError,
  MarketplaceAccountMismatchError,
  ListingNotPublishedError,
  AccountNotReadyError,
} = await import("./marketplace-listing.service.js");
const { AccountBusyError } = await import("./account-operation.service.js");
const { MarketplaceAccountNotFoundError } = await import("./marketplace-account.service.js");

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
    medidas: { unidade: "cm", cintura: null, quadril: null, gancho: null, comprimento: null, largura_barra: null, coxa: null, entrepasso: null, busto: null, largura_ombro: null, comprimento_manga: null },
    peso: { valor: null, unidade: "kg" },
    condicao: { estado: "novo", nota: null, possui_etiqueta: false, possui_defeitos: false, defeitos: [], observacoes: null },
    preco: { preco_original_estimado: null, custo_aquisicao: null, preco_venda: 129.9, preco_promocional: null, moeda: "BRL" },
    estoque: { quantidade: 1, localizacao: { loja: "Loja Principal", setor: null, arara: null, posicao: null } },
    imagens: { principal: { id: "img1", url: "https://example.com/1.jpg", ordem: 0, tipo: null }, galeria: [{ id: "img1", url: "https://example.com/1.jpg", ordem: 0, tipo: null }] },
    ecommerce: { publicado: false, slug: "bermuda-jeans", titulo_seo: null, tags: [] },
    marketplaces: [],
    venda: { vendido: false, data_venda: null, canal_venda: null, valor_venda: null },
    ai_metadata: { generated: false, model: null, generated_at: null, fields: {} },
    auditoria: { criado_por: "user-1", criado_em: new Date(), atualizado_por: "user-1", atualizado_em: new Date() },
    ...overrides,
  };
}

function makeAccount(overrides: Partial<MarketplaceAccountRecord> = {}): MarketplaceAccountRecord {
  return {
    id: "acc-1",
    marketplace: "mercado_livre",
    label: "Loja Demo - Loja 1",
    credential: "CIFRADA-NAO-VAZAR",
    credentialPreview: "****cdef",
    connectionStatus: "connected",
    active: true,
    createdBy: "admin-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    expectedUser: null,
    connectedUserId: null,
    connectedNickname: null,
    ...overrides,
  };
}

function makeListing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    marketplace: "mercado_livre",
    conta_id: "acc-1",
    conta_apelido: "Loja Demo - Loja 1",
    status: "publicado",
    id_anuncio: "MLB123",
    url_anuncio: "https://example.com/MLB123",
    publicado_em: new Date("2026-09-01T12:00:00.000Z"),
    encerrado_em: null,
    erro: null,
    ...overrides,
  };
}

/** Por padrão, `runAccountOperation` chama `operation` com a conta/credencial dadas e devolve `outcome.value`. */
function stubRunAccountOperation(account: MarketplaceAccountRecord = makeAccount(), credential = "plain-credential") {
  runAccountOperationMock.mockImplementation(
    async (_accountId: string, operation: (ctx: { account: MarketplaceAccountRecord; credential: string }) => Promise<{ value: unknown }>) => {
      const outcome = await operation({ account, credential });
      return outcome.value;
    },
  );
}

beforeEach(() => {
  getProductByIdMock.mockReset();
  findByIdMock.mockReset();
  upsertListingMock.mockReset().mockResolvedValue(undefined);
  recordMock.mockReset().mockResolvedValue(undefined);
  runAccountOperationMock.mockReset();
  publishMock.mockReset();
  closeMock.mockReset();
  setMarketplaceConnectorForTesting({
    publish: (...args: unknown[]) => publishMock(...args),
    close: (...args: unknown[]) => closeMock(...args),
  } as never);
  stubRunAccountOperation();
});

describe("marketplace-listing.service.publishListing", () => {
  it("bloqueia publicação sem dados mínimos, sem consultar a conta nem o conector", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct({ preco: { ...makeProduct().preco, preco_venda: null } }));

    await expect(
      publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(ProductMissingRequiredFieldsError);

    expect(findByIdMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
    expect(upsertListingMock).not.toHaveBeenCalled();
  });

  it("bloqueia publicação sem nenhuma foto", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct({ imagens: { principal: null, galeria: [] } }));

    await expect(
      publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(ProductMissingRequiredFieldsError);
  });

  it("conta inexistente ou inativa: MarketplaceAccountNotFoundError, sem chamar o conector", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct());
    findByIdMock.mockResolvedValue(null);

    await expect(
      publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(MarketplaceAccountNotFoundError);
    expect(publishMock).not.toHaveBeenCalled();

    findByIdMock.mockResolvedValue(makeAccount({ active: false }));
    await expect(
      publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(MarketplaceAccountNotFoundError);
  });

  it("rejeita quando a conta não pertence ao marketplace escolhido, sem chamar o conector", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct());
    findByIdMock.mockResolvedValue(makeAccount({ marketplace: "shopee" }));

    await expect(
      publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(MarketplaceAccountMismatchError);

    expect(publishMock).not.toHaveBeenCalled();
    expect(runAccountOperationMock).not.toHaveBeenCalled();
  });

  it("conta ocupada por outra operação (AccountBusyError): propaga, sem gravar nada", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct());
    findByIdMock.mockResolvedValue(makeAccount());
    runAccountOperationMock.mockRejectedValue(new AccountBusyError());

    await expect(
      publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(AccountBusyError);
    expect(upsertListingMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("publicação bem-sucedida grava status=publicado e audita sucesso", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct());
    findByIdMock.mockResolvedValue(makeAccount());
    publishMock.mockResolvedValue({
      value: { id_anuncio: "MLB123", url_anuncio: "https://example.com/MLB123", pendencia: null },
    });

    await publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ credential: "plain-credential", listing: null, product: expect.anything() }),
    );
    expect(upsertListingMock).toHaveBeenCalledWith(
      expect.anything(),
      "prod-1",
      expect.objectContaining({ status: "publicado", id_anuncio: "MLB123", erro: null }),
    );
    expect(recordMock).toHaveBeenCalledWith("PRODUCT_PUBLISH", "product", "prod-1", "u1", expect.objectContaining({ success: true }));
  });

  it("nunca entrega ao conector a credencial cifrada da conta, só a decifrada à parte", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct());
    findByIdMock.mockResolvedValue(makeAccount({ credential: "CIFRADA-NAO-VAZAR" }));
    publishMock.mockResolvedValue({ value: { id_anuncio: "MLB1", url_anuncio: "https://example.com/MLB1", pendencia: null } });

    await publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

    const input = publishMock.mock.calls[0]![0] as { account: Record<string, unknown> };
    expect(input.account).not.toHaveProperty("credential");
    expect(JSON.stringify(input.account)).not.toContain("CIFRADA-NAO-VAZAR");
  });

  it("pendência do conector é gravada em `erro` com o anúncio no ar (status publicado)", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct());
    findByIdMock.mockResolvedValue(makeAccount());
    publishMock.mockResolvedValue({
      value: { id_anuncio: "MLB123", url_anuncio: "https://example.com/MLB123", pendencia: "Anúncio criado, mas a descrição não foi enviada: texto inválido" },
    });

    await publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

    expect(upsertListingMock).toHaveBeenCalledWith(
      expect.anything(),
      "prod-1",
      expect.objectContaining({ status: "publicado", id_anuncio: "MLB123", erro: "Anúncio criado, mas a descrição não foi enviada: texto inválido" }),
    );
  });

  it("passa ao conector a entrada atual da conta no produto (é ela que decide criar × atualizar)", async () => {
    const existing = makeListing();
    const otherAccount = makeListing({ conta_id: "acc-2", id_anuncio: "MLB999" });
    getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [otherAccount, existing] }));
    findByIdMock.mockResolvedValue(makeAccount());
    publishMock.mockResolvedValue({ value: { id_anuncio: "MLB123", url_anuncio: "https://example.com/MLB123", pendencia: null } });

    await publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ listing: existing }));
  });

  it("repassa categoryId ao conector, quando informado (spec 011, seção 4.1; ADR-025)", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct());
    findByIdMock.mockResolvedValue(makeAccount());
    publishMock.mockResolvedValue({ value: { id_anuncio: "MLB123", url_anuncio: "https://example.com/MLB123", pendencia: null } });

    await publishListing({
      productId: "prod-1",
      marketplace: "mercado_livre",
      accountId: "acc-1",
      actingUserId: "u1",
      categoryId: "MLB107292",
    });

    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "MLB107292" }));
  });

  it("repassa listingTypeId ao conector, quando informado (spec 011, seção 4.1; ADR-026)", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct());
    findByIdMock.mockResolvedValue(makeAccount());
    publishMock.mockResolvedValue({ value: { id_anuncio: "MLB123", url_anuncio: "https://example.com/MLB123", pendencia: null } });

    await publishListing({
      productId: "prod-1",
      marketplace: "mercado_livre",
      accountId: "acc-1",
      actingUserId: "u1",
      listingTypeId: "free",
    });

    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ listingTypeId: "free" }));
  });

  describe("falhas: tabela de transições (spec 012, seção 3.1)", () => {
    it("entrada nova (sem id_anuncio) que falha: status=erro, sem id/url, nunca inclui a credencial na mensagem", async () => {
      getProductByIdMock.mockResolvedValue(makeProduct());
      findByIdMock.mockResolvedValue(makeAccount());
      publishMock.mockRejectedValue(new Error("Credencial expirada"));

      const result = await publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

      expect(result).toBeDefined();
      expect(upsertListingMock).toHaveBeenCalledWith(
        expect.anything(),
        "prod-1",
        expect.objectContaining({ status: "erro", id_anuncio: null, url_anuncio: null, erro: "Credencial expirada" }),
      );
      expect(recordMock).toHaveBeenCalledWith("PRODUCT_PUBLISH", "product", "prod-1", "u1", expect.objectContaining({ success: false }));
    });

    it("republicar (id_anuncio existente, status publicado) que falha: continua publicado, mantém id/url, ganha erro", async () => {
      const existing = makeListing({ status: "publicado", id_anuncio: "MLB123", url_anuncio: "https://x/MLB123" });
      getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [existing] }));
      findByIdMock.mockResolvedValue(makeAccount());
      publishMock.mockRejectedValue(new Error("Categoria bloqueada."));

      await publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

      expect(upsertListingMock).toHaveBeenCalledWith(
        expect.anything(),
        "prod-1",
        expect.objectContaining({
          status: "publicado",
          id_anuncio: "MLB123",
          url_anuncio: "https://x/MLB123",
          publicado_em: existing.publicado_em,
          erro: "Categoria bloqueada.",
        }),
      );
    });

    it("recriar (id_anuncio existente, status encerrado) que falha: continua encerrado, mantém o histórico, ganha erro", async () => {
      const existing = makeListing({ status: "encerrado", id_anuncio: "MLB-OLD", encerrado_em: new Date("2026-09-10T00:00:00.000Z") });
      getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [existing] }));
      findByIdMock.mockResolvedValue(makeAccount());
      publishMock.mockRejectedValue(new Error("Domínio sem tabela de medidas."));

      await publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

      expect(upsertListingMock).toHaveBeenCalledWith(
        expect.anything(),
        "prod-1",
        expect.objectContaining({
          status: "encerrado",
          id_anuncio: "MLB-OLD",
          encerrado_em: existing.encerrado_em,
          erro: "Domínio sem tabela de medidas.",
        }),
      );
    });

    it("recriar que TEM sucesso: novo id_anuncio, status publicado, encerrado_em limpo", async () => {
      const existing = makeListing({ status: "encerrado", id_anuncio: "MLB-OLD", encerrado_em: new Date() });
      getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [existing] }));
      findByIdMock.mockResolvedValue(makeAccount());
      publishMock.mockResolvedValue({ value: { id_anuncio: "MLB-NOVO", url_anuncio: "https://x/MLB-NOVO", pendencia: null } });

      await publishListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

      expect(upsertListingMock).toHaveBeenCalledWith(
        expect.anything(),
        "prod-1",
        expect.objectContaining({ status: "publicado", id_anuncio: "MLB-NOVO", encerrado_em: null }),
      );
    });
  });
});

describe("marketplace-listing.service.closeListing (spec 011, seção 4.7)", () => {
  it("entrada não publicada (ausente): ListingNotPublishedError, sem consultar a conta nem o conector", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [] }));

    await expect(
      closeListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(ListingNotPublishedError);
    expect(findByIdMock).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("entrada com status diferente de publicado (erro, encerrado): ListingNotPublishedError", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [makeListing({ status: "encerrado" })] }));
    await expect(
      closeListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(ListingNotPublishedError);

    getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [makeListing({ status: "erro", id_anuncio: null })] }));
    await expect(
      closeListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(ListingNotPublishedError);
  });

  it("conta inexistente: MarketplaceAccountNotFoundError, sem chamar o conector", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [makeListing()] }));
    findByIdMock.mockResolvedValue(null);

    await expect(
      closeListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(MarketplaceAccountNotFoundError);
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("conta inativa ou desconectada: AccountNotReadyError, sem chamar o conector", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [makeListing()] }));
    findByIdMock.mockResolvedValue(makeAccount({ active: false }));
    await expect(
      closeListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(AccountNotReadyError);

    findByIdMock.mockResolvedValue(makeAccount({ connectionStatus: "disconnected" }));
    await expect(
      closeListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(AccountNotReadyError);

    expect(closeMock).not.toHaveBeenCalled();
    expect(runAccountOperationMock).not.toHaveBeenCalled();
  });

  it("sucesso: grava status=encerrado, encerrado_em preenchido, erro limpo, audita PRODUCT_UNPUBLISH", async () => {
    const listing = makeListing();
    getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [listing] }));
    findByIdMock.mockResolvedValue(makeAccount());
    closeMock.mockResolvedValue({ value: { encerrado: true } });

    await closeListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

    expect(closeMock).toHaveBeenCalledWith(expect.objectContaining({ listing, credential: "plain-credential" }));
    expect(upsertListingMock).toHaveBeenCalledWith(
      expect.anything(),
      "prod-1",
      expect.objectContaining({ status: "encerrado", id_anuncio: listing.id_anuncio, erro: null }),
    );
    const upserted = upsertListingMock.mock.calls[0]![2] as MarketplaceListing;
    expect(upserted.encerrado_em).toBeInstanceOf(Date);
    expect(recordMock).toHaveBeenCalledWith(
      "PRODUCT_UNPUBLISH",
      "product",
      "prod-1",
      "u1",
      expect.objectContaining({ success: true, idAnuncio: listing.id_anuncio }),
    );
  });

  it("falha ao encerrar: mantém publicado, erro prefixado com 'Falha ao encerrar:', nunca lança", async () => {
    const listing = makeListing();
    getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [listing] }));
    findByIdMock.mockResolvedValue(makeAccount());
    closeMock.mockRejectedValue(new Error("Item moderado."));

    const result = await closeListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

    expect(result).toBeDefined();
    expect(upsertListingMock).toHaveBeenCalledWith(
      expect.anything(),
      "prod-1",
      expect.objectContaining({ status: "publicado", id_anuncio: listing.id_anuncio, erro: "Falha ao encerrar: Item moderado." }),
    );
    expect(recordMock).toHaveBeenCalledWith(
      "PRODUCT_UNPUBLISH",
      "product",
      "prod-1",
      "u1",
      expect.objectContaining({ success: false }),
    );
  });

  it("conta ocupada por outra operação (AccountBusyError): propaga, sem gravar nada", async () => {
    getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [makeListing()] }));
    findByIdMock.mockResolvedValue(makeAccount());
    runAccountOperationMock.mockRejectedValue(new AccountBusyError());

    await expect(
      closeListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" }),
    ).rejects.toThrow(AccountBusyError);
    expect(upsertListingMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("nunca entrega a credencial cifrada ao conector nem a inclui na mensagem de erro", async () => {
    const listing = makeListing();
    getProductByIdMock.mockResolvedValue(makeProduct({ marketplaces: [listing] }));
    findByIdMock.mockResolvedValue(makeAccount({ credential: "CIFRADA-NAO-VAZAR" }));
    closeMock.mockRejectedValue(new Error("falha qualquer"));

    await closeListing({ productId: "prod-1", marketplace: "mercado_livre", accountId: "acc-1", actingUserId: "u1" });

    const input = closeMock.mock.calls[0]![0] as { account: Record<string, unknown> };
    expect(input.account).not.toHaveProperty("credential");
    expect(JSON.stringify(input.account)).not.toContain("CIFRADA-NAO-VAZAR");
  });
});
