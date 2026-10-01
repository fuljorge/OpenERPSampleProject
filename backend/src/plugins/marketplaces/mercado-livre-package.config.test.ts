import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../../schemas/product.schema.js";

const findMock = vi.fn();

vi.mock("../../repositories/mercado-livre-package-settings.repository.js", () => ({
  mercadoLivrePackageSettingsRepository: { find: (...args: unknown[]) => findMock(...args) },
}));

const { PackageConfigError, resolvePackage } = await import("./mercado-livre-package.config.js");

const FAKE_DB = {} as never;

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

beforeEach(() => {
  findMock.mockReset();
});

describe("resolvePackage (spec 012, seção 3.4; ADR-027)", () => {
  it("sem pacote padrão configurado no banco: falha com mensagem clara", async () => {
    findMock.mockResolvedValue(null);

    await expect(resolvePackage(FAKE_DB, makeProduct())).rejects.toThrow(PackageConfigError);
    await expect(resolvePackage(FAKE_DB, makeProduct())).rejects.toThrow(/Pacote padrão do Mercado Livre não configurado/);
  });

  it("usa o pacote padrão configurado", async () => {
    findMock.mockResolvedValue({
      altura_cm: 5,
      largura_cm: 25,
      comprimento_cm: 30,
      peso_g: 300,
      updatedAt: new Date(),
      updatedBy: "admin-1",
    });

    await expect(resolvePackage(FAKE_DB, makeProduct())).resolves.toEqual({
      altura_cm: 5,
      largura_cm: 25,
      comprimento_cm: 30,
      peso_g: 300,
    });
  });

  it("o peso do produto (kg → g, arredondado para cima) tem prioridade sobre o peso_g configurado", async () => {
    findMock.mockResolvedValue({ altura_cm: 5, largura_cm: 25, comprimento_cm: 30, peso_g: 300, updatedAt: new Date(), updatedBy: "admin-1" });

    const result = await resolvePackage(FAKE_DB, makeProduct({ peso: { valor: 0.451, unidade: "kg" } }));
    expect(result.peso_g).toBe(451);
  });

  it("arredonda o peso para cima mesmo com fração pequena", async () => {
    findMock.mockResolvedValue({ altura_cm: 5, largura_cm: 25, comprimento_cm: 30, peso_g: 300, updatedAt: new Date(), updatedBy: "admin-1" });

    const result = await resolvePackage(FAKE_DB, makeProduct({ peso: { valor: 0.4001, unidade: "kg" } }));
    expect(result.peso_g).toBe(401);
  });

  it("sem peso do produto, usa o peso_g configurado (sempre presente — schema exige)", async () => {
    findMock.mockResolvedValue({ altura_cm: 5, largura_cm: 25, comprimento_cm: 30, peso_g: 300, updatedAt: new Date(), updatedBy: "admin-1" });

    const result = await resolvePackage(FAKE_DB, makeProduct());
    expect(result.peso_g).toBe(300);
  });
});
