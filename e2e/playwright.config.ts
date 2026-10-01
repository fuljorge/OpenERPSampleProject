import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, ".env") });

const BACKEND_PORT = 3333;
const FRONTEND_PORT = 5173;
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

/**
 * Env explícito do processo do backend levantado pelo webServer — nunca herda o `.env` de
 * dev por acidente, sempre o do ambiente de E2E (cluster de teste dedicado).
 */
const backendEnv = {
  NODE_ENV: "test",
  PORT: String(BACKEND_PORT),
  MONGODB_URI: process.env.MONGODB_URI ?? "",
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "",
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? "",
  FRONTEND_URL: BASE_URL,
  // Container `product-images-test` (ADR-003) — mesma Storage Account de dev/prod, upload de
  // fotos real durante o spec "cadastrar peça manualmente" (005).
  AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING ?? "",
  AZURE_STORAGE_CONTAINER_NAME: process.env.AZURE_STORAGE_CONTAINER_NAME ?? "",
  // Chave-mestra que protege as credenciais cifradas no banco (ADR-021) — precisa existir no
  // processo do backend pra decifrar tanto credenciais de marketplace quanto (spec 013) a API
  // key de IA gravada em `ai_settings` por `global-setup.ts`.
  MARKETPLACE_CREDENTIAL_MASTER_KEY: process.env.MARKETPLACE_CREDENTIAL_MASTER_KEY ?? "",
  // AI_API_KEY/AI_BASE_URL/AI_MODEL não são mais repassadas pro processo do backend (spec 013)
  // — `ai-intake.service.ts` só lê a configuração do banco (`ai_settings`, semeada por
  // `global-setup.ts` a partir das mesmas variáveis, ver lá). Continuam existindo em
  // `e2e/.env`/`.env.example` só como a fonte que o `global-setup.ts` lê pra semear.
};

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // reuseExistingServer: em dev local, reaproveita servidores já rodando (`npm run dev` manual)
  // — CUIDADO: se você tiver o backend de DEV rodando manualmente nesta porta, os testes vão
  // rodar contra o banco de dev, não o de teste. Em CI (sem servidor prévio) isso nunca ocorre.
  webServer: [
    {
      command: "npm run dev",
      cwd: path.resolve(__dirname, "../backend"),
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: backendEnv,
      timeout: 30_000,
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT}`,
      cwd: path.resolve(__dirname, "../frontend"),
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
