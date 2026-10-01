/**
 * Garante (idempotente) que o admin e a categoria de fixture existem no cluster de teste
 * antes dos specs rodarem. Reaproveita os módulos reais do backend (mesmo hash Argon2id,
 * mesmos repositories) em vez de inserir documentos manualmente — mesmo espírito do
 * `seed-admin.ts` (ADR-004).
 */
import { connectMongo, disconnectMongo } from "../backend/src/database/mongo.client.js";
import { aiSettingsRepository } from "../backend/src/repositories/ai-settings.repository.js";
import { categoryRepository } from "../backend/src/repositories/category.repository.js";
import { userRepository } from "../backend/src/repositories/user.repository.js";
import { encryptCredential, maskCredential } from "../backend/src/services/credential-encryption.service.js";
import { hashPassword } from "../backend/src/services/password.service.js";

/** Código de categoria fixo (regex de 003 só aceita letras) — usado pelos specs de 005. */
export const E2E_CATEGORY_CODE = "ETESTE";
export const E2E_CATEGORY_NAME = "Categoria E2E";

export default async function globalSetup(): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_ADMIN_EMAIL e E2E_ADMIN_PASSWORD precisam estar definidos (ver e2e/.env).");
  }

  const db = await connectMongo();

  const existingAdmin = await userRepository.findByEmail(db, email);
  if (!existingAdmin) {
    const passwordHash = await hashPassword(password);
    await userRepository.create(db, {
      name: "E2E Admin",
      email,
      passwordHash,
      role: "admin",
      createdBy: null,
    });
  }

  const existingCategory = await categoryRepository.findByCode(db, E2E_CATEGORY_CODE);
  if (!existingCategory) {
    await categoryRepository.create(db, {
      code: E2E_CATEGORY_CODE,
      name: E2E_CATEGORY_NAME,
      department: "Unissex",
    });
  }

  // Configuração do provedor de IA (spec 013) — antes vinha via `backendEnv` do
  // playwright.config.ts (AI_API_KEY/AI_BASE_URL/AI_MODEL repassadas pro processo do backend);
  // agora `ai-intake.service.ts` só lê do banco, então quem tem que existir aqui é o documento
  // `ai_settings`, não a env var solta. Chamado direto no repositório (bypassa
  // `ai-settings.service.ts` de propósito, mesmo espírito de `userRepository.create` acima —
  // evita gerar `AI_SETTINGS_UPDATE` em `audit_logs` a cada execução da suíte).
  const aiApiKey = process.env.AI_API_KEY;
  const aiModel = process.env.AI_MODEL;
  if (!aiApiKey || !aiModel) {
    throw new Error("AI_API_KEY e AI_MODEL precisam estar definidos (ver e2e/.env) para semear a configuração de IA de teste.");
  }
  const existingAiSettings = await aiSettingsRepository.find(db);
  if (!existingAiSettings) {
    await aiSettingsRepository.upsert(
      db,
      {
        baseUrl: process.env.AI_BASE_URL ?? "",
        model: aiModel,
        apiKey: await encryptCredential(aiApiKey),
        apiKeyPreview: maskCredential(aiApiKey),
      },
      "e2e-global-setup",
    );
  }

  await disconnectMongo();
}
