import type { FastifyInstance } from "fastify";
import marketplaceAccountRoutes from "../routes/marketplace-account.routes.js";
import marketplaceListingRoutes from "../routes/marketplace-listing.routes.js";
import { registerMarketplaceConnector } from "../plugins/marketplaces/connector-registry.js";
import { mercadoLivreConnector } from "../plugins/marketplaces/mercado-livre.connector.js";

// `publish()` do conector do Mercado Livre ainda lança "não implementado" (spec 012, tarefa T054
// pendente) — registrar mesmo assim deixa `close()` (já pronto) funcionando de ponta a ponta.
registerMarketplaceConnector("mercado_livre", mercadoLivreConnector);

export default async function marketplaceModule(fastify: FastifyInstance) {
  await fastify.register(marketplaceAccountRoutes, { prefix: "/api/marketplace-accounts" });
  await fastify.register(marketplaceListingRoutes, { prefix: "/api/products" });
}
