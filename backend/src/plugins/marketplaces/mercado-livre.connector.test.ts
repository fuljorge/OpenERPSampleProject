import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorAccount, CloseInput } from "./marketplace-connector.port.js";
import type { MarketplaceListing } from "../../../../shared/dist/schemas/marketplace.schema.js";

const refreshTokenMock = vi.fn();
const closeItemMock = vi.fn();
const predictCategoryMock = vi.fn();
const getCategoryMock = vi.fn();
const getActiveSizeChartDomainsMock = vi.fn();

vi.mock("./mercado-livre-oauth.client.js", async () => {
  const actual = await vi.importActual<typeof import("./mercado-livre-oauth.client.js")>("./mercado-livre-oauth.client.js");
  return {
    ...actual,
    mercadoLivreOAuthClient: { refreshToken: (...args: unknown[]) => refreshTokenMock(...args) },
  };
});

vi.mock("./mercado-livre-api.client.js", async () => {
  const actual = await vi.importActual<typeof import("./mercado-livre-api.client.js")>("./mercado-livre-api.client.js");
  return {
    ...actual,
    closeItem: (...args: unknown[]) => closeItemMock(...args),
    predictCategory: (...args: unknown[]) => predictCategoryMock(...args),
    getCategory: (...args: unknown[]) => getCategoryMock(...args),
    getActiveSizeChartDomains: (...args: unknown[]) => getActiveSizeChartDomainsMock(...args),
  };
});

const { mercadoLivreConnector, suggestCategory, suggestSizes, suggestShipping } = await import("./mercado-livre.connector.js");
const { MercadoLivreInvalidGrantError, MercadoLivreOAuthError } = await import("./mercado-livre-oauth.client.js");
const { MercadoLivreApiError } = await import("./mercado-livre-api.client.js");
const { MarketplaceConnectorError } = await import("./marketplace-connector.port.js");

const ACCOUNT: ConnectorAccount = {
  id: "acc-1",
  marketplace: "mercado_livre",
  label: "Loja",
  credentialPreview: "****3906",
  connectionStatus: "connected",
  active: true,
  expectedUser: "OPENERPSAMPLE",
  connectedNickname: "OPENERPSAMPLE",
  createdBy: "admin-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const LISTING: MarketplaceListing = {
  marketplace: "mercado_livre",
  conta_id: "acc-1",
  conta_apelido: "Loja",
  status: "publicado",
  id_anuncio: "MLB123",
  url_anuncio: "https://produto.mercadolivre.com.br/MLB-123",
  publicado_em: new Date(),
  encerrado_em: null,
  erro: null,
};

function credentialJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    client_id: "1",
    client_secret: "segredo",
    access_token: "ACESSO-ATUAL",
    refresh_token: "REFRESH-ATUAL",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h no futuro — não precisa renovar
    user_id: 987654,
    ...overrides,
  });
}

function closeInput(overrides: Partial<CloseInput> = {}): CloseInput {
  return { account: ACCOUNT, credential: credentialJson(), listing: LISTING, ...overrides };
}

beforeEach(() => {
  refreshTokenMock.mockReset();
  closeItemMock.mockReset();
  predictCategoryMock.mockReset();
  // Sem catalogDomain por padrão: applicable false sem precisar mockar toda a cadeia de chamadas
  // — testes que exercitam a sugestão de tamanho de verdade ficam em mercado-livre-publish.test.ts.
  getCategoryMock.mockReset().mockResolvedValue({ catalogDomain: undefined });
  getActiveSizeChartDomainsMock.mockReset().mockResolvedValue([]);
});

describe("token (spec 012, seção 2.3)", () => {
  it("credencial sem tokens: erro 'conta não conectada', reconnectRequired, sem chamar a API", async () => {
    const error = await mercadoLivreConnector
      .close(closeInput({ credential: JSON.stringify({ client_id: "1", client_secret: "s" }) }))
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      );

    expect(error).toBeInstanceOf(MarketplaceConnectorError);
    expect((error as InstanceType<typeof MarketplaceConnectorError>).reconnectRequired).toBe(true);
    expect(closeItemMock).not.toHaveBeenCalled();
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it("expires_at a menos de 5 min: renova antes de chamar a API e devolve updatedCredential", async () => {
    refreshTokenMock.mockResolvedValue({ accessToken: "ACESSO-NOVO", refreshToken: "REFRESH-NOVO", expiresIn: 21600, userId: 987654 });
    closeItemMock.mockResolvedValue({ alreadyClosed: false });

    const result = await mercadoLivreConnector.close(
      closeInput({ credential: credentialJson({ expires_at: new Date(Date.now() + 60_000).toISOString() }) }),
    );

    expect(refreshTokenMock).toHaveBeenCalledWith({ clientId: "1", clientSecret: "segredo", refreshToken: "REFRESH-ATUAL" });
    expect(closeItemMock).toHaveBeenCalledWith("ACESSO-NOVO", "MLB123");
    expect(JSON.parse(result.updatedCredential!)).toMatchObject({ access_token: "ACESSO-NOVO", refresh_token: "REFRESH-NOVO" });
  });

  it("expires_at ausente: trata como vencido e renova", async () => {
    refreshTokenMock.mockResolvedValue({ accessToken: "ACESSO-NOVO", refreshToken: "REFRESH-NOVO", expiresIn: 21600, userId: 987654 });
    closeItemMock.mockResolvedValue({ alreadyClosed: false });

    await mercadoLivreConnector.close(closeInput({ credential: credentialJson({ expires_at: undefined }) }));

    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
  });

  it("token ainda válido: não renova, updatedCredential fica undefined", async () => {
    closeItemMock.mockResolvedValue({ alreadyClosed: false });

    const result = await mercadoLivreConnector.close(closeInput());

    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(closeItemMock).toHaveBeenCalledWith("ACESSO-ATUAL", "MLB123");
    expect(result.updatedCredential).toBeUndefined();
  });

  it("invalid_grant na renovação proativa: reconnectRequired, sem chamar a API", async () => {
    refreshTokenMock.mockRejectedValue(new MercadoLivreInvalidGrantError("refresh token expirado"));

    const error = await mercadoLivreConnector
      .close(closeInput({ credential: credentialJson({ expires_at: new Date(Date.now() + 1000).toISOString() }) }))
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      );

    expect((error as InstanceType<typeof MarketplaceConnectorError>).reconnectRequired).toBe(true);
    expect(closeItemMock).not.toHaveBeenCalled();
  });

  it("erro de rede na renovação proativa: MarketplaceConnectorError SEM reconnectRequired", async () => {
    refreshTokenMock.mockRejectedValue(new MercadoLivreOAuthError("Não foi possível falar com o Mercado Livre."));

    const error = await mercadoLivreConnector
      .close(closeInput({ credential: credentialJson({ expires_at: new Date(Date.now() + 1000).toISOString() }) }))
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      );

    expect((error as InstanceType<typeof MarketplaceConnectorError>).reconnectRequired).toBe(false);
  });

  it("401 na chamada: renova à força e repete a chamada uma vez", async () => {
    closeItemMock.mockRejectedValueOnce(new MercadoLivreApiError("token expirado", 401, "invalid_token"));
    closeItemMock.mockResolvedValueOnce({ alreadyClosed: false });
    refreshTokenMock.mockResolvedValue({ accessToken: "ACESSO-FORCADO", refreshToken: "REFRESH-FORCADO", expiresIn: 21600, userId: 987654 });

    const result = await mercadoLivreConnector.close(closeInput());

    expect(closeItemMock).toHaveBeenCalledTimes(2);
    expect(closeItemMock).toHaveBeenNthCalledWith(1, "ACESSO-ATUAL", "MLB123");
    expect(closeItemMock).toHaveBeenNthCalledWith(2, "ACESSO-FORCADO", "MLB123");
    expect(JSON.parse(result.updatedCredential!)).toMatchObject({ access_token: "ACESSO-FORCADO" });
  });

  it("401 e a renovação forçada também falha com invalid_grant: reconnectRequired, sem repetir a chamada", async () => {
    closeItemMock.mockRejectedValueOnce(new MercadoLivreApiError("token expirado", 401, "invalid_token"));
    refreshTokenMock.mockRejectedValue(new MercadoLivreInvalidGrantError("refresh token já usado"));

    const error = await mercadoLivreConnector.close(closeInput()).then(
      () => new Error("deveria ter falhado"),
      (err: Error) => err,
    );

    expect((error as InstanceType<typeof MarketplaceConnectorError>).reconnectRequired).toBe(true);
    expect(closeItemMock).toHaveBeenCalledTimes(1);
  });

  it("401 e a chamada repetida falha de novo: erro final carrega o updatedCredential da renovação forçada", async () => {
    closeItemMock.mockRejectedValueOnce(new MercadoLivreApiError("token expirado", 401, "invalid_token"));
    closeItemMock.mockRejectedValueOnce(new MercadoLivreApiError("Item moderado.", 403, "forbidden"));
    refreshTokenMock.mockResolvedValue({ accessToken: "ACESSO-FORCADO", refreshToken: "REFRESH-FORCADO", expiresIn: 21600, userId: 987654 });

    const error = (await mercadoLivreConnector.close(closeInput()).then(
      () => new Error("deveria ter falhado"),
      (err: Error) => err,
    )) as InstanceType<typeof MarketplaceConnectorError>;

    expect(error.message).toBe("Item moderado.");
    expect(JSON.parse(error.updatedCredential!)).toMatchObject({ access_token: "ACESSO-FORCADO" });
  });

  it("renovação proativa seguida de falha na chamada: o updatedCredential da renovação é preservado no erro", async () => {
    refreshTokenMock.mockResolvedValue({ accessToken: "ACESSO-NOVO", refreshToken: "REFRESH-NOVO", expiresIn: 21600, userId: 987654 });
    closeItemMock.mockRejectedValue(new MercadoLivreApiError("Categoria bloqueada.", 400, "some_code"));

    const error = (await mercadoLivreConnector
      .close(closeInput({ credential: credentialJson({ expires_at: new Date(Date.now() + 1000).toISOString() }) }))
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      )) as InstanceType<typeof MarketplaceConnectorError>;

    expect(error.message).toBe("Categoria bloqueada.");
    expect(JSON.parse(error.updatedCredential!)).toMatchObject({ access_token: "ACESSO-NOVO" });
  });

  it("nunca inclui client_secret nem tokens na mensagem de erro", async () => {
    refreshTokenMock.mockRejectedValue(new MercadoLivreInvalidGrantError("refresh token expirado"));

    const error = await mercadoLivreConnector
      .close(closeInput({ credential: credentialJson({ expires_at: new Date(Date.now() + 1000).toISOString() }) }))
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      );

    expect(error.message).not.toContain("segredo");
    expect(error.message).not.toContain("ACESSO-ATUAL");
    expect(error.message).not.toContain("REFRESH-ATUAL");
  });
});

describe("close (spec 012, seção 7)", () => {
  it("entrada sem id_anuncio: erro claro, sem chamar a API nem renovar token", async () => {
    const error = await mercadoLivreConnector
      .close(closeInput({ listing: { ...LISTING, id_anuncio: null } }))
      .then(
        () => new Error("deveria ter falhado"),
        (err: Error) => err,
      );

    expect(error.message).toContain("não tem um id do Mercado Livre");
    expect(closeItemMock).not.toHaveBeenCalled();
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it("sucesso: chama api.closeItem com o access token e o id do anúncio", async () => {
    closeItemMock.mockResolvedValue({ alreadyClosed: false });

    const result = await mercadoLivreConnector.close(closeInput());

    expect(result.value).toEqual({ encerrado: true });
    expect(closeItemMock).toHaveBeenCalledWith("ACESSO-ATUAL", "MLB123");
  });

  it("item já encerrado no Mercado Livre: idempotente, mesmo resultado de sucesso", async () => {
    closeItemMock.mockResolvedValue({ alreadyClosed: true });

    await expect(mercadoLivreConnector.close(closeInput())).resolves.toEqual({ value: { encerrado: true }, updatedCredential: undefined });
  });
});

describe("suggestCategory (spec 012, seção 4; ADR-025; T058) — fora da MarketplaceConnectorPort", () => {
  it("devolve a categoria sugerida pelo preditor, com o access token válido", async () => {
    predictCategoryMock.mockResolvedValue({
      categoryId: "MLB107292",
      categoryName: "Camisas",
      domainId: "MLB-SHIRTS",
      domainName: "Camisas",
      attributes: [],
    });

    const result = await suggestCategory(credentialJson(), "Camisa social masculina");

    expect(predictCategoryMock).toHaveBeenCalledWith("ACESSO-ATUAL", "Camisa social masculina");
    expect(result.value).toEqual({ categoryId: "MLB107292", categoryName: "Camisas" });
  });

  it("preditor sem resultado (null): devolve value null, não é erro", async () => {
    predictCategoryMock.mockResolvedValue(null);

    const result = await suggestCategory(credentialJson(), "xyz");

    expect(result.value).toBeNull();
  });

  it("renova o token quando necessário, como publish/close", async () => {
    refreshTokenMock.mockResolvedValue({ accessToken: "ACESSO-NOVO", refreshToken: "REFRESH-NOVO", expiresIn: 21600, userId: 987654 });
    predictCategoryMock.mockResolvedValue(null);

    const result = await suggestCategory(credentialJson({ expires_at: new Date(Date.now() + 1000).toISOString() }), "camisa");

    expect(predictCategoryMock).toHaveBeenCalledWith("ACESSO-NOVO", "camisa");
    expect(JSON.parse(result.updatedCredential!)).toMatchObject({ access_token: "ACESSO-NOVO" });
  });

  it("falha do preditor sai como MarketplaceConnectorError (o serviço decide não travar a revisão por causa disso)", async () => {
    predictCategoryMock.mockRejectedValue(new MercadoLivreApiError("Serviço indisponível", 503, "service_unavailable"));

    const error = await suggestCategory(credentialJson(), "camisa").then(
      () => new Error("deveria ter falhado"),
      (err: Error) => err,
    );

    expect(error).toBeInstanceOf(MarketplaceConnectorError);
  });
});

describe("suggestSizes (spec 012, calçado; ADR-032, roupa) — delega para mercado-livre-publish.ts", () => {
  it("categoria sem catalogDomain: applicable false (a orquestração completa, calçado e roupa, é testada em mercado-livre-publish.test.ts)", async () => {
    const result = await suggestSizes(credentialJson(), { classificacao: { categoria_codigo: "BERM" } } as never, "MLB188064");
    expect(result.value).toEqual({ applicable: false, available: [], current: null, currentMatches: false, allowCustomSize: false });
  });

  it("renova o token quando necessário, como publish/close/suggestCategory", async () => {
    refreshTokenMock.mockResolvedValue({ accessToken: "ACESSO-NOVO", refreshToken: "REFRESH-NOVO", expiresIn: 21600, userId: 987654 });

    const result = await suggestSizes(
      credentialJson({ expires_at: new Date(Date.now() + 1000).toISOString() }),
      { classificacao: { categoria_codigo: "BERM" } } as never,
      "MLB188064",
    );

    expect(result.value.applicable).toBe(false);
    expect(JSON.parse(result.updatedCredential!)).toMatchObject({ access_token: "ACESSO-NOVO" });
  });
});

describe("suggestShipping (spec 012; achado real 24/09/2026) — delega para mercado-livre-publish.ts", () => {
  it("sem preço de venda: lista vazia, sem chamar rede nenhuma (a orquestração completa é testada em mercado-livre-publish.test.ts)", async () => {
    const result = await suggestShipping(credentialJson(), { preco: { preco_venda: null } } as never, "MLB188064", "free");
    expect(result.value).toEqual([]);
  });

  it("renova o token quando necessário, como publish/close/suggestCategory/suggestSizes", async () => {
    refreshTokenMock.mockResolvedValue({ accessToken: "ACESSO-NOVO", refreshToken: "REFRESH-NOVO", expiresIn: 21600, userId: 987654 });

    const result = await suggestShipping(
      credentialJson({ expires_at: new Date(Date.now() + 1000).toISOString() }),
      { preco: { preco_venda: null } } as never,
      "MLB188064",
      "free",
    );

    expect(result.value).toEqual([]);
    expect(JSON.parse(result.updatedCredential!)).toMatchObject({ access_token: "ACESSO-NOVO" });
  });
});

describe("publish (spec 012, seções 3/3.1; T025/T026) — delega para mercado-livre-publish.ts", () => {
  it("sem categoryId: erro claro, sem chamar rede nenhuma (a orquestração completa é testada em mercado-livre-publish.test.ts)", async () => {
    await expect(
      mercadoLivreConnector.publish({ account: ACCOUNT, credential: credentialJson(), listing: null, product: {} as never, categoryId: null }),
    ).rejects.toThrow(/Nenhuma categoria confirmada/);
    expect(closeItemMock).not.toHaveBeenCalled();
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });
});
