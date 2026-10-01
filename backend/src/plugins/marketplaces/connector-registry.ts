import type { Marketplace } from "../../schemas/marketplace-account.schema.js";
import type { MarketplaceConnectorPort } from "./marketplace-connector.port.js";

/**
 * Registro de conectores por marketplace (spec 012, plano, Fase 2). Um marketplace sem conector
 * registrado **não finge sucesso**: pedir o conector lança um erro claro, e o serviço grava a
 * publicação como `erro` (spec 011, seção 4.6).
 */
const registered: Partial<Record<Marketplace, MarketplaceConnectorPort>> = {};

/** Dublê de teste: quando definido, vale para **qualquer** marketplace e tem prioridade sobre o registro. */
let testOverride: MarketplaceConnectorPort | undefined;

export function registerMarketplaceConnector(marketplace: Marketplace, connector: MarketplaceConnectorPort): void {
  registered[marketplace] = connector;
}

export function getConnector(marketplace: Marketplace): MarketplaceConnectorPort {
  const connector = testOverride ?? registered[marketplace];
  if (!connector) {
    throw new Error(
      `Nenhum conector de marketplace configurado para ${marketplace} — a implementação concreta é escopo de uma spec própria por marketplace (011, seção 5).`,
    );
  }
  return connector;
}

/** Seam de teste — injeta um dublê (ou, com `undefined`, volta a usar só o registro). */
export function setMarketplaceConnectorForTesting(fake: MarketplaceConnectorPort | undefined): void {
  testOverride = fake;
}

/** Só para testes do próprio registro — limpa o que foi registrado. */
export function clearRegisteredConnectorsForTesting(): void {
  for (const key of Object.keys(registered) as Marketplace[]) delete registered[key];
  testOverride = undefined;
}
