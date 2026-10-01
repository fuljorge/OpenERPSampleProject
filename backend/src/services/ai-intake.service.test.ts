import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Category } from "../repositories/category.repository.js";
import type { AiProviderPort } from "../plugins/ai/ai-provider.port.js";

const listMock = vi.fn();
const getProductByIdMock = vi.fn();
const downloadImageMock = vi.fn();

vi.mock("../repositories/category.repository.js", () => ({
  categoryRepository: {
    list: (...args: unknown[]) => listMock(...args),
  },
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

// `ProductNotFoundError` continua real (usado nos testes abaixo via `rejects.toBeInstanceOf`)
// — só `getProductById` é fake.
vi.mock("./product.service.js", async () => {
  const actual = await vi.importActual<typeof import("./product.service.js")>("./product.service.js");
  return { ...actual, getProductById: (...args: unknown[]) => getProductByIdMock(...args) };
});

// `assertValidImage` continua real (analyzeProduct depende dela) — só `downloadImage` é fake,
// pra reanalyzeProduct não tentar falar com o Azure Blob Storage de verdade.
vi.mock("./image.service.js", async () => {
  const actual = await vi.importActual<typeof import("./image.service.js")>("./image.service.js");
  return { ...actual, downloadImage: (...args: unknown[]) => downloadImageMock(...args) };
});

const {
  analyzeProduct,
  reanalyzeProduct,
  setAiProviderForTesting,
  AiProviderRequestError,
  ImageDownloadFailedError,
  InvalidAiResponseError,
  NoImagesProvidedError,
  NoSavedImagesError,
  TooManyImagesError,
} = await import("./ai-intake.service.js");
const { InvalidImageTypeError } = await import("./image.service.js");
const { ProductNotFoundError } = await import("./product.service.js");
const { MAX_PRODUCT_IMAGES } = await import("../../../shared/dist/schemas/product.schema.js");

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: "cat-1",
    code: "BERM",
    name: "Bermudas",
    department: "Masculino",
    active: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeImage() {
  return { buffer: Buffer.from("fake-image-bytes"), mimeType: "image/jpeg" };
}

function fakeProvider(response: unknown): AiProviderPort {
  return { analyze: vi.fn().mockResolvedValue(response) };
}

function baseSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    identificacao: { nome: "Bermuda Jeans", descricao: null },
    classificacao: { categoria_codigo: "BERM", subcategoria: null, estilo: [], ocasiao: [], estacao: [] },
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
    medidas: {
      unidade: "cm",
      cintura: null,
      quadril: null,
      gancho: null,
      comprimento: null,
      largura_barra: null,
      coxa: null,
      entrepasso: null,
      busto: null,
      largura_ombro: null,
      comprimento_manga: null,
    },
    condicao: {
      estado: "novo",
      nota: null,
      possui_etiqueta: null,
      possui_defeitos: null,
      defeitos: [],
      observacoes: null,
    },
    ...overrides,
  };
}

describe("ai-intake.service.analyzeProduct", () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue([makeCategory()]);
  });

  it("rejeita quando nenhuma imagem é enviada", async () => {
    await expect(analyzeProduct({ prompt: "bermuda", images: [] })).rejects.toBeInstanceOf(NoImagesProvidedError);
  });

  it(`rejeita mais de ${MAX_PRODUCT_IMAGES} imagens`, async () => {
    const images = Array.from({ length: MAX_PRODUCT_IMAGES + 1 }, fakeImage);
    await expect(analyzeProduct({ prompt: "bermuda", images })).rejects.toBeInstanceOf(TooManyImagesError);
  });

  it("rejeita imagem com MIME type inválido antes de chamar o provedor", async () => {
    const provider = fakeProvider(baseSuggestion());
    setAiProviderForTesting(provider);

    await expect(
      analyzeProduct({ prompt: "bermuda", images: [{ buffer: Buffer.from("x"), mimeType: "application/pdf" }] }),
    ).rejects.toBeInstanceOf(InvalidImageTypeError);
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("propaga null quando o adapter não determina um atributo (marca) — nunca inventa", async () => {
    setAiProviderForTesting(fakeProvider(baseSuggestion()));
    const result = await analyzeProduct({ prompt: "bermuda azul", images: [fakeImage()] });
    expect(result.marca.nome).toBeNull();
  });

  it("o schema pedido no prompt inclui genero e busto (T060 — regressão: já divergiu do schema real uma vez)", async () => {
    const provider = fakeProvider(baseSuggestion());
    setAiProviderForTesting(provider);
    await analyzeProduct({ prompt: "bermuda azul", images: [fakeImage()] });

    const [sentPrompt] = (provider.analyze as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    expect(sentPrompt).toContain('"genero"');
    expect(sentPrompt).toContain('"busto"');
  });

  it("o schema pedido no prompt inclui largura_ombro e comprimento_manga (24/09/2026 — mesma classe de regressão do T060)", async () => {
    const provider = fakeProvider(baseSuggestion());
    setAiProviderForTesting(provider);
    await analyzeProduct({ prompt: "jaqueta de couro", images: [fakeImage()] });

    const [sentPrompt] = (provider.analyze as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    expect(sentPrompt).toContain('"largura_ombro"');
    expect(sentPrompt).toContain('"comprimento_manga"');
  });

  it("provedor de IA rejeita a requisição (ex.: 400 do gateway): erro amigável com o detalhe real, não some cru (achado real 25/09/2026, troca pra Gemma)", async () => {
    setAiProviderForTesting({ analyze: vi.fn().mockRejectedValue(new Error("400 status code (no body)")) });
    await expect(analyzeProduct({ prompt: "bermuda", images: [fakeImage()] })).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(analyzeProduct({ prompt: "bermuda", images: [fakeImage()] })).rejects.toThrow(/400 status code \(no body\)/);
  });

  it("rejeita payload com campo obrigatório ausente (Zod)", async () => {
    setAiProviderForTesting(fakeProvider({ identificacao: { nome: "x", descricao: null } }));
    await expect(analyzeProduct({ prompt: "bermuda", images: [fakeImage()] })).rejects.toBeInstanceOf(
      InvalidAiResponseError,
    );
  });

  it("segurança: JSON com sku/preco/status extra é rejeitado pelo .strict() — nunca ignorado em silêncio (spec 8.4)", async () => {
    setAiProviderForTesting(
      fakeProvider({ ...baseSuggestion(), sku: "ERP-BERM-000001", preco: { preco_venda: 1 }, status: "disponivel" }),
    );
    await expect(analyzeProduct({ prompt: "bermuda", images: [fakeImage()] })).rejects.toBeInstanceOf(
      InvalidAiResponseError,
    );
  });

  it("segurança: categoria_codigo fora da taxonomia ativa vira null — defesa independe do prompt (spec 8.2-D)", async () => {
    setAiProviderForTesting(
      fakeProvider(
        baseSuggestion({
          classificacao: { categoria_codigo: "INVENTADA", subcategoria: null, estilo: [], ocasiao: [], estacao: [] },
        }),
      ),
    );
    const result = await analyzeProduct({ prompt: "bermuda", images: [fakeImage()] });
    expect(result.classificacao.categoria_codigo).toBeNull();
  });

  it("aceita categoria_codigo quando corresponde a uma categoria ativa", async () => {
    setAiProviderForTesting(fakeProvider(baseSuggestion()));
    const result = await analyzeProduct({ prompt: "bermuda", images: [fakeImage()] });
    expect(result.classificacao.categoria_codigo).toBe("BERM");
  });
});

function fakeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    identificacao: { nome: "Bermuda Jeans", descricao: "Bermuda jeans azul, tamanho 32" },
    imagens: { principal: null, galeria: [{ id: "foto-1.jpg", url: "https://blob.test/foto-1.jpg", ordem: 0, tipo: null }] },
    ...overrides,
  };
}

describe("ai-intake.service.reanalyzeProduct (spec 006, seção 9 — 24/09/2026)", () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue([makeCategory()]);
    getProductByIdMock.mockReset();
    downloadImageMock.mockReset();
    downloadImageMock.mockResolvedValue(fakeImage());
  });

  it("produto inexistente: propaga ProductNotFoundError, sem baixar fotos nem chamar a IA", async () => {
    getProductByIdMock.mockRejectedValue(new ProductNotFoundError());
    const provider = fakeProvider(baseSuggestion());
    setAiProviderForTesting(provider);

    await expect(reanalyzeProduct("prod-inexistente")).rejects.toBeInstanceOf(ProductNotFoundError);
    expect(downloadImageMock).not.toHaveBeenCalled();
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("produto sem nenhuma foto salva: rejeita com NoSavedImagesError, sem chamar a IA", async () => {
    getProductByIdMock.mockResolvedValue(fakeProduct({ imagens: { principal: null, galeria: [] } }));
    const provider = fakeProvider(baseSuggestion());
    setAiProviderForTesting(provider);

    await expect(reanalyzeProduct("prod-1")).rejects.toBeInstanceOf(NoSavedImagesError);
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("baixa cada foto da galeria e usa a descrição atual como prompt", async () => {
    getProductByIdMock.mockResolvedValue(
      fakeProduct({
        imagens: {
          principal: null,
          galeria: [
            { id: "foto-1.jpg", url: "https://blob.test/foto-1.jpg", ordem: 0, tipo: null },
            { id: "foto-2.jpg", url: "https://blob.test/foto-2.jpg", ordem: 1, tipo: null },
          ],
        },
      }),
    );
    const provider = fakeProvider(baseSuggestion());
    setAiProviderForTesting(provider);

    await reanalyzeProduct("prod-1");

    expect(downloadImageMock).toHaveBeenCalledTimes(2);
    expect(downloadImageMock).toHaveBeenCalledWith("foto-1.jpg");
    expect(downloadImageMock).toHaveBeenCalledWith("foto-2.jpg");
    const [sentPrompt] = (provider.analyze as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    expect(sentPrompt).toContain("Bermuda jeans azul, tamanho 32");
  });

  it("descrição vazia: usa o nome do produto como prompt", async () => {
    getProductByIdMock.mockResolvedValue(fakeProduct({ identificacao: { nome: "Bermuda Jeans", descricao: "" } }));
    const provider = fakeProvider(baseSuggestion());
    setAiProviderForTesting(provider);

    await reanalyzeProduct("prod-1");

    const [sentPrompt] = (provider.analyze as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    expect(sentPrompt).toContain("Bermuda Jeans");
  });

  it("resultado idêntico ao de analyzeProduct dado o mesmo input (mesma validação/defesas)", async () => {
    getProductByIdMock.mockResolvedValue(fakeProduct());
    setAiProviderForTesting(fakeProvider(baseSuggestion({ marca: { nome: "Nike", original: true } })));

    const result = await reanalyzeProduct("prod-1");
    expect(result.marca.nome).toBe("Nike");
    expect(result.classificacao.categoria_codigo).toBe("BERM");
  });

  it("achado real testando (24/09/2026): foto órfã (blob removido direto no Azure, fora de DELETE /api/images) — nunca vaza o erro bruto do SDK, converte em ImageDownloadFailedError", async () => {
    getProductByIdMock.mockResolvedValue(fakeProduct());
    downloadImageMock.mockRejectedValue(Object.assign(new Error(""), { name: "RestError", statusCode: 404 }));
    const provider = fakeProvider(baseSuggestion());
    setAiProviderForTesting(provider);

    await expect(reanalyzeProduct("prod-1")).rejects.toBeInstanceOf(ImageDownloadFailedError);
    expect(provider.analyze).not.toHaveBeenCalled();
  });
});
