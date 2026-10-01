import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;

// T021 — spec 002-usuarios, tasks.md ("front e back")
test("operador recebe acesso negado em /admin/users tanto no frontend quanto na API", async ({
  page,
}) => {
  // Admin cria um operador só para este teste.
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/");

  const operatorEmail = `e2e.acesso.${Date.now()}@example.com`;
  const operatorPassword = "senha-e2e-acesso-123";

  await page.goto("/admin/users/new");
  await page.fill('input[type="text"]', "E2E Operador Bloqueado");
  await page.fill('input[type="email"]', operatorEmail);
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(operatorPassword);
  await passwordFields.nth(1).fill(operatorPassword);
  await page.locator("select").nth(0).selectOption("operator");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin/users");

  // Logout do admin, login como o operador recém-criado.
  await page.goto("/");
  await page.click('button:has-text("Sair")');
  await page.waitForURL("**/login");
  await page.fill('input[type="email"]', operatorEmail);
  await page.fill('input[type="password"]', operatorPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL("/");

  // Frontend: acesso direto por URL não deve nem carregar a página — deve redirecionar.
  await page.goto("/admin/users");
  await expect(page).not.toHaveURL(/\/admin\/users$/);
  expect(new URL(page.url()).pathname).toBe("/");

  // Backend: a API recusa com 403, não é só a UI escondendo o link (spec 002, critério de
  // aceite) — usa o mesmo contexto/cookies da página logada.
  const response = await page.request.get("/api/users");
  expect(response.status()).toBe(403);
});
