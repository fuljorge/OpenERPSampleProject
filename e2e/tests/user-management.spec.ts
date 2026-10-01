import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/");
}

// T020 — spec 002-usuarios, tasks.md
test("admin cria um usuário e depois edita nome e perfil", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/admin/users");
  await expect(page.locator("table")).toBeVisible();

  const uniqueEmail = `e2e.criacao.${Date.now()}@example.com`;

  await page.getByText("+ Novo usuário").click();
  await page.waitForURL("**/admin/users/new");

  await page.fill('input[type="text"]', "E2E Criado");
  await page.fill('input[type="email"]', uniqueEmail);
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill("senha-e2e-123");
  await passwordFields.nth(1).fill("senha-e2e-123");
  await page.locator("select").nth(0).selectOption("operator");
  await page.click('button[type="submit"]');

  await page.waitForURL("**/admin/users");
  await expect(page.getByText(uniqueEmail)).toBeVisible();

  const row = page.locator("tr", { hasText: uniqueEmail });
  await expect(row).toContainText("Operador");
  await expect(row).toContainText("Ativo");

  await row.getByText("Editar").click();
  await page.waitForURL(/\/admin\/users\/[a-f0-9]+$/);

  await page.fill('input[type="text"]', "E2E Editado");
  await page.locator("select").first().selectOption("viewer");
  await page.click('button[type="submit"]');

  await page.waitForURL("**/admin/users");
  const editedRow = page.locator("tr", { hasText: uniqueEmail });
  await expect(editedRow).toContainText("E2E Editado");
  await expect(editedRow).toContainText("Consulta");
});
