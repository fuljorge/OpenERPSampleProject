import { expect, test, type Locator, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;

// Categoria de fixture seedada (idempotente) por global-setup.ts — mesma constante lá.
const CATEGORY_CODE = "ETESTE";
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

// Um JPEG mínimo, mas real o suficiente para o navegador anexar como `image/jpeg` — o backend
// valida o MIME type do header multipart, não a estrutura do arquivo.
const FIXTURE_PHOTO = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64",
);

// T024 — spec 005-produtos-cadastro-manual, tasks.md
test("operador cadastra uma peça manualmente, com foto, e ela aparece na listagem", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/products");
  await expect(page.locator("table")).toBeVisible();

  const nome = `E2E Camisa Cadastro ${Date.now()}`;

  await page.getByText("+ Novo produto").click();
  await page.waitForURL("**/products/new");

  await fieldset(page, "Identificação").locator('input[type="text"]').first().fill(nome);
  await fieldset(page, "Classificação").locator("select").selectOption({ label: CATEGORY_NAME });
  await fieldset(page, "Condição").locator("select").selectOption("novo");

  // Upload de foto (spec 005, seção 4.1 / 007-imagens) — sobe de verdade para o Azure Blob
  // Storage do ambiente de teste (product-images-test). Dois inputs de arquivo agora existem
  // (botões "Tirar foto"/"Galeria", spec 007 seção 5) — usa o de galeria (sem `capture`, já
  // que não há câmera num teste headless).
  const fotos = fieldset(page, "Fotos");
  await fotos.locator('input[type="file"]:not([capture])').setInputFiles({
    name: "foto-e2e.jpg",
    mimeType: "image/jpeg",
    buffer: FIXTURE_PHOTO,
  });
  await expect(fotos.locator("img")).toBeVisible({ timeout: 10_000 });
  await expect(fotos.getByText("1 de 10 fotos")).toBeVisible();

  await page.click('button[type="submit"]');

  await page.waitForURL("**/products");
  const row = page.locator("tr", { hasText: nome });
  await expect(row).toBeVisible();
  await expect(row).toContainText(new RegExp(`ERP-${CATEGORY_CODE}-\\d+`));
  await expect(row).toContainText("Rascunho");
  // A capa (primeira foto enviada) substitui o placeholder "Sem foto" no card do produto.
  await expect(row.locator("img")).toBeVisible();
});
