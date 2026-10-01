import { beforeEach, describe, expect, it, vi } from "vitest";

const countDocumentsMock = vi.fn((filter: Record<string, unknown>) => {
  if (filter.status === "disponivel") return Promise.resolve(5);
  if ("identificacao.data_cadastro" in filter) return Promise.resolve(2);
  if (filter.status === "vendido") return Promise.resolve(3);
  if (filter.status === "em_revisao") return Promise.resolve(1);
  if ("preco.preco_venda" in filter) return Promise.resolve(4);
  if ("imagens.principal" in filter) return Promise.resolve(6);
  throw new Error(`Filtro inesperado em countDocuments: ${JSON.stringify(filter)}`);
});

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({ collection: () => ({ countDocuments: countDocumentsMock }) }),
}));

const { getSummary } = await import("./dashboard.service.js");

describe("dashboard.service.getSummary", () => {
  beforeEach(() => {
    countDocumentsMock.mockClear();
  });

  it("agrega os 6 indicadores do MVP (spec 009, seção 2)", async () => {
    const summary = await getSummary();
    expect(summary).toEqual({
      disponiveis: 5,
      cadastradosHoje: 2,
      vendidos: 3,
      emRevisao: 1,
      semPreco: 4,
      semImagens: 6,
    });
  });

  it("exclui produtos inativos dos indicadores 'sem preço' e 'sem imagens'", async () => {
    await getSummary();

    const semPrecoCall = countDocumentsMock.mock.calls.find(([filter]) => "preco.preco_venda" in filter);
    const semImagensCall = countDocumentsMock.mock.calls.find(([filter]) => "imagens.principal" in filter);

    expect(semPrecoCall?.[0]).toMatchObject({ status: { $ne: "inativo" } });
    expect(semImagensCall?.[0]).toMatchObject({ status: { $ne: "inativo" } });
  });

  it("'cadastrados hoje' filtra a partir do início do dia corrente", async () => {
    await getSummary();

    const cadastradosHojeCall = countDocumentsMock.mock.calls.find(
      ([filter]) => "identificacao.data_cadastro" in filter,
    );
    const gte = (cadastradosHojeCall?.[0]["identificacao.data_cadastro"] as { $gte: Date }).$gte;

    expect(gte.getHours()).toBe(0);
    expect(gte.getMinutes()).toBe(0);
    expect(gte.getSeconds()).toBe(0);
  });
});
