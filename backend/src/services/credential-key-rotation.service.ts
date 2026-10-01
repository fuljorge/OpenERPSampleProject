import { getDb } from "../database/mongo.client.js";
import { marketplaceAccountRepository } from "../repositories/marketplace-account.repository.js";
import { tryAcquireAccountLease } from "./account-operation.service.js";
import { record } from "./audit-log.service.js";
import { decryptCredential, encryptCredential, getCredentialKeyId } from "./credential-encryption.service.js";
import { createNextCredentialKey, getActiveKeyInfo, type ActiveKeyInfo } from "./credential-key.service.js";

/** Re-cifrar uma conta é rápido; a trava só precisa cobrir isso. */
const ROTATION_LEASE_TTL_MS = 30_000;

export interface CredentialKeyRotationReport {
  previousKeyId: string;
  newKeyId: string;
  total: number;
  rotated: number;
  alreadyCurrent: number;
  /**
   * Conta editada por um admin durante a rotação, ou **ocupada por uma operação do conector** (trava por
   * conta — spec 012, seção 2.3) — nada foi sobrescrito; uma nova rotação tenta de novo.
   */
  skippedConcurrent: number;
  /** Continuam legíveis (as chaves antigas nunca são apagadas); uma nova rotação tenta de novo. */
  failed: { accountId: string; reason: string }[];
}

export interface EncryptionKeyStatus {
  activeKey: ActiveKeyInfo;
  /** Contas por id de chave (`"?"` = formato irreconhecível). */
  accountsByKeyId: Record<string, number>;
}

export async function getEncryptionKeyStatus(): Promise<EncryptionKeyStatus> {
  const activeKey = await getActiveKeyInfo();
  const accounts = await marketplaceAccountRepository.list(getDb());

  const accountsByKeyId: Record<string, number> = {};
  for (const account of accounts) {
    const keyId = getCredentialKeyId(account.credential) ?? "?";
    accountsByKeyId[keyId] = (accountsByKeyId[keyId] ?? 0) + 1;
  }
  return { activeKey, accountsByKeyId };
}

/**
 * Rotação manual da chave de criptografia (botão do admin — spec 011, seção 3.1; ADR-021): cria
 * uma nova chave de dados, que passa a ser a ativa, e re-cifra toda credencial para ela.
 * Chaves antigas são **retidas** (só decifram) — uma conta que falhe ao re-cifrar continua
 * legível e é reportada, sem interromper as demais. Nunca retorna nem loga credenciais.
 */
export async function rotateCredentialKey(actingAdminId: string): Promise<CredentialKeyRotationReport> {
  const { previous, next } = await createNextCredentialKey(actingAdminId);
  const db = getDb();
  const accounts = await marketplaceAccountRepository.list(db);

  const report: CredentialKeyRotationReport = {
    previousKeyId: previous.id,
    newKeyId: next.id,
    total: accounts.length,
    rotated: 0,
    alreadyCurrent: 0,
    skippedConcurrent: 0,
    failed: [],
  };

  for (const account of accounts) {
    if (getCredentialKeyId(account.credential) === next.id) {
      report.alreadyCurrent += 1;
      continue;
    }

    // Uma publicação/encerramento em andamento pode estar renovando os tokens desta conta: re-cifrar agora
    // roubaria a gravação dela. Conta ocupada é pulada e fica para a próxima rotação (spec 012, seção 2.3).
    const release = await tryAcquireAccountLease(account.id, ROTATION_LEASE_TTL_MS);
    if (!release) {
      report.skippedConcurrent += 1;
      continue;
    }

    try {
      const reencrypted = await encryptCredential(await decryptCredential(account.credential));
      const replaced = await marketplaceAccountRepository.replaceCredentialCiphertext(
        db,
        account.id,
        account.credential,
        reencrypted,
      );
      if (replaced) report.rotated += 1;
      else report.skippedConcurrent += 1;
    } catch (err) {
      report.failed.push({
        accountId: account.id,
        reason: err instanceof Error ? err.message : "Falha desconhecida ao re-cifrar.",
      });
    } finally {
      await release();
    }
  }

  await record("MARKETPLACE_CREDENTIAL_KEY_ROTATE", "marketplace_account", undefined, actingAdminId, {
    previousKeyId: previous.id,
    newKeyId: next.id,
    rotated: report.rotated,
    failed: report.failed.length,
  });

  return report;
}
