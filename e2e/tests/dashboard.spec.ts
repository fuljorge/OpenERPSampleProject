import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;

const INDICATOR_LABELS = [
  "Produtos disponíveis",
  "Produtos cadastrados hoje",
  "Produtos vendidos",
  "Produtos em revisão",
  "Produtos sem preço",
  "Produtos sem imagens",
];

// T013 — spec 009-dashboard, tasks.md. Também fecha T021 de
// specs/001-autenticacao/tasks.md ("login completo até o dashboard"), que ficava bloqueada
// esperando 009 existir para ter um destino real pós-login (antes disso, a home era um
// placeholder) — é o mesmo cenário, não faz sentido duplicar em dois arquivos.
test("login redireciona ao dashboard e os 6 indicadores carregam sem erro", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForURL("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  for (const label of INDICATOR_LABELS) {
    // Sobe do <p> do rótulo até o <div> do Card (005) para checar o valor numérico ao lado,
    // sem depender de índice/posição na grade.
    const card = page.locator(`xpath=//p[text()="${label}"]/parent::div`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(/\d+/);
  }
});
