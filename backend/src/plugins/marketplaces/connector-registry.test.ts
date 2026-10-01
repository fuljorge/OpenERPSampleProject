import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRegisteredConnectorsForTesting,
  getConnector,
  registerMarketplaceConnector,
  setMarketplaceConnectorForTesting,
} from "./connector-registry.js";
import { MarketplaceConnectorError, type MarketplaceConnectorPort } from "./marketplace-connector.port.js";

function fakeConnector(): MarketplaceConnectorPort {
  return { publish: vi.fn(), close: vi.fn() };
}

afterEach(() => clearRegisteredConnectorsForTesting());

describe("connector-registry", () => {
  it("devolve o conector registrado para o marketplace certo", () => {
    const mercadoLivre = fakeConnector();
    const shopee = fakeConnector();
    registerMarketplaceConnector("mercado_livre", mercadoLivre);
    registerMarketplaceConnector("shopee", shopee);

    expect(getConnector("mercado_livre")).toBe(mercadoLivre);
    expect(getConnector("shopee")).toBe(shopee);
  });

  it("marketplace sem conector lança erro claro, sem fingir sucesso", () => {
    registerMarketplaceConnector("mercado_livre", fakeConnector());

    expect(() => getConnector("ebay")).toThrow(/Nenhum conector de marketplace configurado para ebay/);
  });

  it("o dublê de teste vale para qualquer marketplace e tem prioridade sobre o registro", () => {
    const registered = fakeConnector();
    const fake = fakeConnector();
    registerMarketplaceConnector("mercado_livre", registered);
    setMarketplaceConnectorForTesting(fake);

    expect(getConnector("mercado_livre")).toBe(fake);
    expect(getConnector("ebay")).toBe(fake);
  });

  it("remover o dublê (undefined) volta a usar só o registro", () => {
    const registered = fakeConnector();
    registerMarketplaceConnector("mercado_livre", registered);
    setMarketplaceConnectorForTesting(fakeConnector());
    setMarketplaceConnectorForTesting(undefined);

    expect(getConnector("mercado_livre")).toBe(registered);
    expect(() => getConnector("shopee")).toThrow(/Nenhum conector/);
  });
});

describe("MarketplaceConnectorError", () => {
  it("carrega a credencial renovada e o pedido de reconexão", () => {
    const error = new MarketplaceConnectorError("Refresh token expirado", {
      updatedCredential: '{"access_token":"novo"}',
      reconnectRequired: true,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Refresh token expirado");
    expect(error.updatedCredential).toBe('{"access_token":"novo"}');
    expect(error.reconnectRequired).toBe(true);
  });

  it("por padrão não exige reconexão nem traz credencial nova", () => {
    const error = new MarketplaceConnectorError("Falha de rede");

    expect(error.reconnectRequired).toBe(false);
    expect(error.updatedCredential).toBeUndefined();
  });
});
