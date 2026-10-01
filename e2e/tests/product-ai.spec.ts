import { expect, test, type Locator, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;

// Categoria de fixture seedada (idempotente) por global-setup.ts — mesma constante lá.
const CATEGORY_NAME = "Categoria E2E";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/");
}

// Achado real (24/09/2026): `ProductForm.tsx` envolve todas as seções num
// `<fieldset class="contents">` (trava tudo no modo "view") — sem excluí-lo, `hasText`
// também casa com esse wrapper (que contém o texto de toda seção como descendente), e
// `.first()` sempre resolve pra ele (primeiro `<fieldset>` no DOM), silenciosamente buscando
// em TODO o formulário em vez de só na seção pedida.
function fieldset(page: Page, legend: string): Locator {
  return page.locator("fieldset:not(.contents)", { hasText: legend }).first();
}

async function productCountFor(page: Page, search: string): Promise<number> {
  const response = await page.request.get(`/api/products?search=${encodeURIComponent(search)}`);
  const body = await response.json();
  return body.data.total as number;
}

// PNG 1x1 válido de verdade — o provedor de IA decodifica a imagem; bytes inválidos/truncados
// são rejeitados por ele (400), descoberto testando manualmente durante a implementação de 006
// (ver tasks.md). Suficiente aqui porque o sinal real desta análise vem do texto da descrição.
const FIXTURE_PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/**
 * Os dois testes deste arquivo chamam o provedor de IA real (sem mock de adapter — mesma
 * filosofia de infraestrutura real do resto do e2e, ver e2e/AGENTS.md). `test.describe.serial`
 * é deliberado: rodando os dois em paralelo (padrão do `fullyParallel` do projeto), o provedor
 * self-hosted usado no ambiente de teste não responde à segunda chamada concorrente dentro do
 * timeout — descoberto rodando a suíte inteira durante a implementação (T018/T019, tasks.md).
 * Não é um bug da aplicação, é uma característica operacional do provedor atual; forçar
 * sequencial aqui é mais simples e mais barato que investir em fila/retry para um cenário que
 * só acontece em teste.
 */
test.describe.serial("cadastro de produto assistido por IA (spec 006)", () => {
  // T018 — tasks.md
  test("operador cadastra uma peça usando IA: analisar e revisar não persistem nada antes de salvar", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await loginAsAdmin(page);

    await page.goto("/products");
    await page.getByText("+ Cadastrar com IA").click();
    await page.waitForURL("**/products/ai-new");

    await page.locator('input[type="file"]:not([capture])').setInputFiles({
      name: "foto-e2e.png",
      mimeType: "image/png",
      buffer: FIXTURE_PHOTO,
    });
    await page
      .locator("#ai-prompt")
      .fill("Bermuda jeans azul, masculina, tamanho 32, seminova, sem defeitos aparentes.");

    const analyzeButton = page.getByRole("button", { name: "Analisar com IA" });
    await expect(analyzeButton).toBeEnabled();
    await analyzeButton.click();

    // Resposta real da IA — pode levar dezenas de segundos.
    await expect(page.getByText("O que a IA identificou:")).toBeVisible({ timeout: 90_000 });

    const nomeInput = fieldset(page, "Identificação").locator('input[type="text"]').first();
    await expect(nomeInput).not.toHaveValue("");

    // Nome exclusivo desta execução — permite confirmar via API que nada foi persistido só
    // pela análise, sem depender do texto exato que a IA gerou (não determinístico) nem
    // competir com outros specs rodando em paralelo na mesma categoria de fixture.
    const nomeExclusivo = `E2E IA Cadastro ${Date.now()}`;
    await nomeInput.fill(nomeExclusivo);

    expect(await productCountFor(page, nomeExclusivo)).toBe(0);

    // Garante a categoria independente do que a IA sugeriu — só existe uma categoria ativa
    // neste ambiente de teste ("Categoria E2E"), não necessariamente o que a IA escolheria
    // para uma bermuda de verdade.
    await fieldset(page, "Classificação").locator("select").selectOption({ label: CATEGORY_NAME });
    await fieldset(page, "Condição").locator("select").selectOption("novo");

    await page.click('button[type="submit"]');

    await page.waitForURL("**/products");
    const row = page.locator("tr", { hasText: nomeExclusivo });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Rascunho");
    expect(await productCountFor(page, nomeExclusivo)).toBe(1);
  });

  // T019 — tasks.md. A tarefa original previa "mockar adapter retornando marca.nome: null",
  // mas o e2e deste projeto nunca mocka infraestrutura — em vez disso, a descrição
  // deliberadamente omite qualquer marca/etiqueta, validado (testes manuais durante a
  // implementação) como suficiente para o provedor real retornar `null` em vez de inventar
  // uma marca (spec 006, seção 8.3, regra 6: null é sempre preferível a um palpite).
  test("dado desconhecido pela IA nunca é inventado: marca não identificável fica em branco", async ({ page }) => {
    test.setTimeout(120_000);

    await loginAsAdmin(page);
    await page.goto("/products/ai-new");

    await page.locator('input[type="file"]:not([capture])').setInputFiles({
      name: "foto-e2e.png",
      mimeType: "image/png",
      buffer: FIXTURE_PHOTO,
    });
    await page
      .locator("#ai-prompt")
      .fill(
        "Peça de roupa lisa, sem nenhuma etiqueta de marca visível, sem logotipo e sem qualquer identificação de fabricante.",
      );

    await page.getByRole("button", { name: "Analisar com IA" }).click();
    await expect(page.getByText("O que a IA identificou:")).toBeVisible({ timeout: 90_000 });

    await expect(page.getByText("⚠ Marca não identificada")).toBeVisible();

    const marcaInput = fieldset(page, "Marca").locator('input[type="text"]').first();
    await expect(marcaInput).toHaveValue("");
  });
});
