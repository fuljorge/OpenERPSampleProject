import "dotenv/config";
import crypto from "node:crypto";
import { connectMongo, disconnectMongo } from "../database/mongo.client.js";
import { userRepository } from "../repositories/user.repository.js";
import { record } from "../services/audit-log.service.js";
import { hashPassword } from "../services/password.service.js";

/**
 * Cria o primeiro usuário `admin` quando não existe nenhum — quebra o ciclo "ovo e galinha"
 * de 002-usuarios (criação de usuário exige role=admin, mas o primeiro admin não pode ser
 * criado por ninguém). Idempotente: não faz nada se já existir qualquer usuário `admin`.
 * Uso: SEED_ADMIN_EMAIL=... [SEED_ADMIN_PASSWORD=...] npm run seed:admin
 * Ver ADR-004 em memory/decisions.md.
 */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const name = process.env.SEED_ADMIN_NAME ?? "Administrador";

  if (!email) {
    throw new Error(
      "Defina SEED_ADMIN_EMAIL antes de rodar npm run seed:admin (ex.: no .env ou inline: " +
        "SEED_ADMIN_EMAIL=admin@example.com npm run seed:admin).",
    );
  }

  let password = process.env.SEED_ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(12).toString("base64url");
    generated = true;
  }
  if (password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD deve ter ao menos 8 caracteres (regra de 002-usuarios).");
  }

  const db = await connectMongo();

  const existingAdmin = await userRepository.findOneByRole(db, "admin");
  if (existingAdmin) {
    console.log(
      `Já existe um usuário admin (${existingAdmin.email}) — nada foi criado. ` +
        "Este script só cria o admin inicial quando não existe nenhum.",
    );
    return;
  }

  const passwordHash = await hashPassword(password);
  const admin = await userRepository.create(db, {
    name,
    email,
    passwordHash,
    role: "admin",
    createdBy: null,
  });

  // Sem "ator" distinto para registrar como userId — é o bootstrap do primeiro usuário, não
  // uma ação de outro admin (constituição, princípio IX: toda mutação relevante é auditada).
  await record("USER_CREATE", "user", admin.id, undefined, { source: "seed-admin script" });

  console.log(`Admin inicial criado: ${admin.email}`);
  if (generated) {
    console.log(`Senha temporária gerada (ANOTE AGORA — não será exibida de novo): ${password}`);
  }
}

main()
  .catch((err: unknown) => {
    console.error("Falha ao criar admin inicial:", err);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
