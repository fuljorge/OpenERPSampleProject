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

// T026 — spec 005-produtos-cadastro-manual, tasks.md
test("admin marca uma peça disponível como vendida", async ({ page }) => {
  await loginAsAdmin(page);

  const nome = `E2E Peça Vendida ${Date.now()}`;

  // "Marcar como vendida" só é uma transição válida a partir de disponivel/reservado (ver
  // ALLOWED_TRANSITIONS em product.service.ts) — cria já como "Disponível" para não precisar
  // passar por em_revisao antes.
  await page.goto("/products/new");
  await fieldset(page, "Identificação").locator('input[type="text"]').first().fill(nome);
  await fieldset(page, "Identificação").locator("select").selectOption("disponivel");
  await fieldset(page, "Classificação").locator("select").selectOption({ label: CATEGORY_NAME });
  await fieldset(page, "Condição").locator("select").selectOption("novo");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/products");

  const row = page.locator("tr", { hasText: nome });
  await expect(row).toContainText("Disponível");

  await row.getByText("Marcar como vendida").click();

  await expect(row).toContainText("Vendido", { timeout: 10_000 });
  await expect(row.getByText("Marcar como vendida")).toHaveCount(0);
});
