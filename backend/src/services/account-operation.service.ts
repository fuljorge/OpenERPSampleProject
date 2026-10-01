import { randomUUID } from "node:crypto";
import { getDb } from "../database/mongo.client.js";
import { MarketplaceConnectorError, type ConnectorOutcome } from "../plugins/marketplaces/marketplace-connector.port.js";
import {
  marketplaceAccountRepository,
  type MarketplaceAccountRecord,
} from "../repositories/marketplace-account.repository.js";
import { decryptCredential, encryptCredential } from "./credential-encryption.service.js";
import { MarketplaceAccountNotFoundError } from "./marketplace-account.service.js";

/**
 * Trava por conta e persistência de credencial (spec 012, seção 2.3; ADR-023).
 *
 * Toda operação que fala com o marketplace em nome de uma conta (publicar, atualizar, encerrar) roda
 * **uma por vez por conta**: duas operações simultâneas não podem gastar o mesmo `refresh_token`
 * (uso único no Mercado Livre — perder o par novo deixaria a conta permanentemente expirada).
 * A trava vive no próprio documento da conta (sem Redis nem fila — princípio V), então vale para
 * várias réplicas.
 */

/** Validade da trava: uma publicação faz ~7 chamadas de 15 s no pior caso. Uma trava órfã expira sozinha. */
export const OPERATION_LEASE_TTL_MS = 120_000;
/** Quanto uma operação espera por outra na mesma conta antes de desistir com `AccountBusyError`. */
export const OPERATION_LEASE_WAIT_MS = 15_000;
const POLL_INTERVAL_MS = 250;

export class AccountBusyError extends Error {
  constructor() {
    super("Outra operação está em andamento nesta conta. Tente de novo em instantes.");
    this.name = "AccountBusyError";
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Uma tentativa, sem espera: devolve a função que solta a trava, ou `null` se a conta está ocupada
 * (ou não existe). A rotação de chave usa isto para **pular** contas ocupadas.
 */
export async function tryAcquireAccountLease(
  accountId: string,
  ttlMs: number = OPERATION_LEASE_TTL_MS,
): Promise<(() => Promise<void>) | null> {
  const db = getDb();
  const owner = randomUUID();
  const acquired = await marketplaceAccountRepository.acquireOperationLease(db, accountId, owner, ttlMs);
  if (!acquired) return null;
  return () => marketplaceAccountRepository.releaseOperationLease(db, accountId, owner);
}

async function acquireWithWait(
  accountId: string,
  ttlMs: number,
  waitMs: number,
  pollMs: number,
): Promise<() => Promise<void>> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const release = await tryAcquireAccountLease(accountId, ttlMs);
    if (release) return release;
    if (Date.now() >= deadline) throw new AccountBusyError();
    await sleep(pollMs);
  }
}

export interface AccountOperationContext {
  /** A conta como está **depois** de obter a trava (com a credencial já renovada por quem chegou antes). */
  account: MarketplaceAccountRecord;
  /** Credencial decifrada, só em memória — nunca logada. */
  credential: string;
}

export type AccountOperation<T> = (context: AccountOperationContext) => Promise<ConnectorOutcome<T>>;

export interface AccountOperationOptions {
  waitMs?: number;
  pollMs?: number;
  leaseTtlMs?: number;
}

/**
 * Executa `operation` com a trava da conta:
 *
 * 1. espera a trava (até `waitMs`; senão `AccountBusyError` → `409`);
 * 2. **relê** a conta e decifra a credencial — quem estava na frente pode tê-la renovado;
 * 3. roda a operação;
 * 4. em `finally`, grava o `updatedCredential` (no sucesso **e** no erro) de forma condicional ao
 *    valor lido — se a conta foi desconectada ou re-cifrada no meio, o par novo é descartado, para
 *    nunca ressuscitar tokens de uma conta que o admin desconectou;
 * 5. `reconnectRequired` → conta `expired` (só se ela não mudou nem foi desconectada);
 * 6. solta a trava.
 *
 * A credencial e os tokens nunca vão para log nem para mensagem de erro.
 */
export async function runAccountOperation<T>(
  accountId: string,
  operation: AccountOperation<T>,
  options: AccountOperationOptions = {},
): Promise<T> {
  const { waitMs = OPERATION_LEASE_WAIT_MS, pollMs = POLL_INTERVAL_MS, leaseTtlMs = OPERATION_LEASE_TTL_MS } = options;
  const db = getDb();

  // Conta inexistente ou inativa não espera trava nenhuma (mesma regra de `getActiveMarketplaceAccountForConnector`).
  const before = await marketplaceAccountRepository.findById(db, accountId);
  if (!before || !before.active) throw new MarketplaceAccountNotFoundError();

  const release = await acquireWithWait(accountId, leaseTtlMs, waitMs, pollMs);

  let ciphertextRead: string | undefined;
  let updatedCredential: string | undefined;
  let reconnectRequired = false;
  try {
    const account = await marketplaceAccountRepository.findById(db, accountId);
    if (!account || !account.active) throw new MarketplaceAccountNotFoundError();
    ciphertextRead = account.credential;

    const credential = await decryptCredential(account.credential);
    const outcome = await operation({ account, credential });
    updatedCredential = outcome.updatedCredential;
    return outcome.value;
  } catch (err) {
    if (err instanceof MarketplaceConnectorError) {
      updatedCredential = err.updatedCredential;
      reconnectRequired = err.reconnectRequired;
    }
    throw err;
  } finally {
    try {
      await settle(accountId, ciphertextRead, updatedCredential, reconnectRequired);
    } finally {
      await release();
    }
  }
}

/** Grava a credencial renovada e o status `expired`, sem nunca mascarar o resultado da operação. */
async function settle(
  accountId: string,
  ciphertextRead: string | undefined,
  updatedCredential: string | undefined,
  reconnectRequired: boolean,
): Promise<void> {
  if (ciphertextRead === undefined) return;
  const db = getDb();

  try {
    let currentCiphertext = ciphertextRead;
    if (updatedCredential !== undefined) {
      const next = await encryptCredential(updatedCredential);
      if (await marketplaceAccountRepository.replaceCredentialCiphertext(db, accountId, ciphertextRead, next)) {
        currentCiphertext = next;
      } else {
        // A conta mudou durante a operação (desconectada, editada ou re-cifrada): o par novo é descartado.
        console.warn(`[account-operation] credencial renovada descartada: a conta ${accountId} mudou durante a operação.`);
      }
    }
    if (reconnectRequired) {
      await marketplaceAccountRepository.markExpiredIfUnchanged(db, accountId, currentCiphertext);
    }
  } catch (err) {
    // Nunca inclui credencial nem token — só o tipo do problema.
    console.error(
      `[account-operation] falha ao gravar o resultado da renovação da conta ${accountId}:`,
      err instanceof Error ? err.name : "erro desconhecido",
    );
  }
}
