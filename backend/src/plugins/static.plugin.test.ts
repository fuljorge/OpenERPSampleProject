import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import staticPlugin, { FRONTEND_DIST_PATH } from "./static.plugin.js";

describe("static.plugin", () => {
  it("não registra nenhuma rota quando frontend/dist não existe (caso de dev local)", async () => {
    const app = Fastify();
    app.get("/api/health", async () => ({ status: "ok" }));
    await app.register(staticPlugin);

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);

    // Sem o build do frontend, nada além das rotas já registradas responde — nenhum fallback
    // SPA é instalado, e uma rota não mapeada continua um 404 comum.
    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(404);
  });

  it("resolve frontend/dist como irmão de backend/ e shared/ na raiz do monorepo", () => {
    expect(FRONTEND_DIST_PATH.replace(/\\/g, "/")).toMatch(/\/frontend\/dist$/);
  });
});
