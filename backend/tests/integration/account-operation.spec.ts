import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongoServer: MongoMemoryServer;
let disconnectMongo: typeof import("../../src/database/mongo.client.js").disconnectMongo;
let getDb: typeof import("../../src/database/mongo.client.js").getDb;

let repo: typeof import("../../src/repositories/marketplace-account.repository.js").marketplaceAccountRepository;
let encryptCredential: typeof import("../../src/services/credential-encryption.service.js").encryptCredential;
let decryptCredential: typeof import("../../src/services/credential-encryption.service.js").decryptCredential;
let runAccountOperation: typeof import("../../src/services/account-operation.service.js").runAccountOperation;
let tryAcquireAccountLease: typeof import("../../src/services/account-operation.service.js").tryAcquireAccountLease;
let AccountBusyError: typeof import("../../src/services/account-operation.service.js").AccountBusyError;
let MarketplaceConnectorError: typeof import("../../src/plugins/marketplaces/marketplace-connector.port.js").MarketplaceConnectorError;
let MarketplaceAccountNotFoundError: typeof import("../../src/services/marketplace-account.service.js").MarketplaceAccountNotFoundError;

const CONNECTED = { client_id: "1", client_secret: "segredo", access_token: "ACESSO-VELHO", refresh_token: "REFRESH-VELHO" };
const FAST = { waitMs: 400, pollMs: 15 };

beforeAll(async () => {
  process.env.MARKETPLACE_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const mongo = await import("../../src/database/mongo.client.js");
  disconnectMongo = mongo.disconnectMongo;
  getDb = mongo.getDb;
  await mongo.connectMongo();

  repo = (await import("../../src/repositories/marketplace-account.repository.js")).marketplaceAccountRepository;
  ({ encryptCredential, decryptCredential } = await import("../../src/services/credential-encryption.service.js"));
  ({ runAccountOperation, tryAcquireAccountLease, AccountBusyError } = await import(
    "../../src/services/account-operation.service.js"
  ));
  ({ MarketplaceConnectorError } = await import("../../src/plugins/marketplaces/marketplace-connector.port.js"));
  ({ MarketplaceAccountNotFoundError } = await import("../../src/services/marketplace-account.service.js"));
}, 60_000);

afterAll(async () => {
  await disconnectMongo();
  await mongoServer.stop();
});

/** Conta do Mercado Livre já conectada, com a credencial cifrada como em produção. */
async function createConnectedAccount(label: string, credential: Record<string, unknown> = CONNECTED) {
  const db = getDb();
  const account = await repo.create(db, {
    marketplace: "mercado_livre",
    label,
    credential: await encryptCredential(JSON.stringify(credential)),
    credentialPreview: "****0001",
    createdBy: "6aa7f562b389b2490d683b7e",
  });
  await repo.saveConnectedCredential(db, account.id, account.credential, { userId: "1", nickname: "LOJA" });
  return account.id;
}

async function stored(id: string) {
  const account = (await repo.findById(getDb(), id))!;
  return { account, credential: JSON.parse(await decryptCredential(account.credential)) as Record<string, unknown> };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("trava por conta — repositório (T018)", () => {
  it("dois donos disputando: só um obtém; o outro só depois da liberação", async () => {
    const id = await createConnectedAccount("lease-disputa");
    const db = getDb();

    expect(await repo.acquireOperationLease(db, id, "A", 60_000)).toBe(true);
    expect(await repo.acquireOperationLease(db, id, "B", 60_000)).toBe(false);

    await repo.releaseOperationLease(db, id, "A");
    expect(await repo.acquireOperationLease(db, id, "B", 60_000)).toBe(true);
  });

  it("liberar com o dono errado é ignorado", async () => {
    const id = await createConnectedAccount("lease-dono-errado");
    const db = getDb();
    await repo.acquireOperationLease(db, id, "A", 60_000);

    await repo.releaseOperationLease(db, id, "B");

    expect(await repo.acquireOperationLease(db, id, "C", 60_000)).toBe(false);
  });

  it("trava vencida é retomada por outro dono", async () => {
    const id = await createConnectedAccount("lease-vencida");
    const db = getDb();
    await repo.acquireOperationLease(db, id, "morto", 1);
    await sleep(20);

    expect(await repo.acquireOperationLease(db, id, "vivo", 60_000)).toBe(true);
  });

  it("conta inexistente ou id inválido nunca obtém trava", async () => {
    const db = getDb();

    expect(await repo.acquireOperationLease(db, "64b000000000000000000000", "A", 1000)).toBe(false);
    expect(await repo.acquireOperationLease(db, "nao-e-objectid", "A", 1000)).toBe(false);
  });

  it("os campos da trava não aparecem no registro devolvido pela API do repositório", async () => {
    const id = await createConnectedAccount("lease-campos");
    await repo.acquireOperationLease(getDb(), id, "A", 60_000);

    expect((await repo.findById(getDb(), id))!).not.toHaveProperty("operationLeaseOwner");
  });
});

describe("runAccountOperation (T019)", () => {
  it("roda a operação com a credencial decifrada e solta a trava", async () => {
    const id = await createConnectedAccount("op-basico");
    let seen: Record<string, unknown> = {};

    const result = await runAccountOperation(
      id,
      async ({ credential }) => {
        seen = JSON.parse(credential) as Record<string, unknown>;
        return { value: "feito" };
      },
      FAST,
    );

    expect(result).toBe("feito");
    expect(seen).toMatchObject({ access_token: "ACESSO-VELHO" });
    expect(await repo.acquireOperationLease(getDb(), id, "depois", 60_000)).toBe(true);
  });

  it("duas operações na mesma conta rodam em série, nunca ao mesmo tempo", async () => {
    const id = await createConnectedAccount("op-serie");
    const events: string[] = [];
    const op = (name: string) => async () => {
      events.push(`${name}:inicio`);
      await sleep(80);
      events.push(`${name}:fim`);
      return { value: name };
    };

    const [a, b] = await Promise.all([
      runAccountOperation(id, op("A"), { waitMs: 2000, pollMs: 15 }),
      runAccountOperation(id, op("B"), { waitMs: 2000, pollMs: 15 }),
    ]);

    expect([a, b].sort()).toEqual(["A", "B"]);
    // nunca intercalado: cada operação termina antes de a outra começar
    expect(events[0]!.endsWith(":inicio")).toBe(true);
    expect(events[1]).toBe(events[0]!.replace(":inicio", ":fim"));
    expect(events[2]!.endsWith(":inicio")).toBe(true);
    expect(events[3]).toBe(events[2]!.replace(":inicio", ":fim"));
  });

  it("quem espera relê a credencial já renovada por quem estava na frente", async () => {
    const id = await createConnectedAccount("op-relê");
    const seenByB: string[] = [];

    await Promise.all([
      runAccountOperation(
        id,
        async () => {
          await sleep(60);
          return {
            value: "A",
            updatedCredential: JSON.stringify({ ...CONNECTED, access_token: "ACESSO-NOVO", refresh_token: "REFRESH-NOVO" }),
          };
        },
        { waitMs: 2000, pollMs: 15 },
      ),
      (async () => {
        await sleep(10); // garante que A já pegou a trava
        return runAccountOperation(
          id,
          async ({ credential }) => {
            seenByB.push((JSON.parse(credential) as { refresh_token: string }).refresh_token);
            return { value: "B" };
          },
          { waitMs: 2000, pollMs: 15 },
        );
      })(),
    ]);

    // B nunca vê o refresh_token que A já gastou
    expect(seenByB).toEqual(["REFRESH-NOVO"]);
  });

  it("ocupada além do tempo de espera: AccountBusyError, sem rodar a operação", async () => {
    const id = await createConnectedAccount("op-ocupada");
    const release = (await tryAcquireAccountLease(id, 60_000))!;
    let ran = false;

    await expect(
      runAccountOperation(id, async () => ((ran = true), { value: 1 }), { waitMs: 100, pollMs: 15 }),
    ).rejects.toThrow(AccountBusyError);
    expect(ran).toBe(false);

    await release();
    await expect(runAccountOperation(id, async () => ({ value: 2 }), FAST)).resolves.toBe(2);
  });

  it("trava vencida de um processo que caiu não trava a conta", async () => {
    const id = await createConnectedAccount("op-vencida");
    await getDb()
      .collection("marketplace_accounts")
      .updateOne(
        { _id: (await import("mongodb")).ObjectId.createFromHexString(id) },
        { $set: { operationLeaseOwner: "processo-morto", operationLeaseExpiresAt: new Date(Date.now() - 1000) } },
      );

    await expect(runAccountOperation(id, async () => ({ value: "ok" }), FAST)).resolves.toBe("ok");
  });

  it("conta inexistente ou inativa: MarketplaceAccountNotFoundError, sem esperar trava", async () => {
    const inactive = await createConnectedAccount("op-inativa");
    await repo.markDisconnected(getDb(), inactive);
    await repo.updateStatus(getDb(), inactive, false);

    await expect(runAccountOperation("64b000000000000000000000", async () => ({ value: 1 }), FAST)).rejects.toThrow(
      MarketplaceAccountNotFoundError,
    );
    await expect(runAccountOperation(inactive, async () => ({ value: 1 }), FAST)).rejects.toThrow(
      MarketplaceAccountNotFoundError,
    );
  });

  it("erro da operação é relançado como está e a trava é solta", async () => {
    const id = await createConnectedAccount("op-erro");
    const boom = new Error("falha de rede");

    await expect(runAccountOperation(id, async () => Promise.reject(boom), FAST)).rejects.toBe(boom);

    expect(await repo.acquireOperationLease(getDb(), id, "depois", 60_000)).toBe(true);
  });

  it("grava o par de tokens renovado no SUCESSO (cifrado)", async () => {
    const id = await createConnectedAccount("op-grava-sucesso");

    await runAccountOperation(
      id,
      async () => ({
        value: "ok",
        updatedCredential: JSON.stringify({ ...CONNECTED, access_token: "ACESSO-2", refresh_token: "REFRESH-2" }),
      }),
      FAST,
    );

    const { account, credential } = await stored(id);
    expect(credential).toMatchObject({ access_token: "ACESSO-2", refresh_token: "REFRESH-2" });
    expect(account.credential).not.toContain("ACESSO-2");
  });

  it("grava o par renovado mesmo quando a operação FALHA depois (o refresh_token antigo já foi gasto)", async () => {
    const id = await createConnectedAccount("op-grava-erro");

    await expect(
      runAccountOperation(
        id,
        async () => {
          throw new MarketplaceConnectorError("Categoria recusada", {
            updatedCredential: JSON.stringify({ ...CONNECTED, access_token: "ACESSO-3", refresh_token: "REFRESH-3" }),
          });
        },
        FAST,
      ),
    ).rejects.toThrow("Categoria recusada");

    const { account, credential } = await stored(id);
    expect(credential).toMatchObject({ refresh_token: "REFRESH-3" });
    expect(account.connectionStatus).toBe("connected");
  });

  it("descarta o par renovado se a conta foi desconectada durante a operação (não ressuscita tokens)", async () => {
    const id = await createConnectedAccount("op-desconectada");
    const withoutTokens = await encryptCredential(JSON.stringify({ client_id: "1", client_secret: "segredo" }));

    await runAccountOperation(
      id,
      async () => {
        await repo.markDisconnected(getDb(), id, withoutTokens); // o admin desconecta no meio
        return {
          value: "ok",
          updatedCredential: JSON.stringify({ ...CONNECTED, access_token: "ACESSO-ZUMBI", refresh_token: "REFRESH-ZUMBI" }),
        };
      },
      FAST,
    );

    const { account, credential } = await stored(id);
    expect(account.connectionStatus).toBe("disconnected");
    expect(credential).toEqual({ client_id: "1", client_secret: "segredo" });
  });

  it("reconnectRequired marca a conta como expirada", async () => {
    const id = await createConnectedAccount("op-expirada");

    await expect(
      runAccountOperation(
        id,
        async () => {
          throw new MarketplaceConnectorError("Reconecte a conta", { reconnectRequired: true });
        },
        FAST,
      ),
    ).rejects.toThrow("Reconecte a conta");

    expect((await stored(id)).account.connectionStatus).toBe("expired");
  });

  it("erro de rede (sem reconnectRequired) NÃO muda o status de conexão", async () => {
    const id = await createConnectedAccount("op-rede");

    await expect(
      runAccountOperation(id, async () => Promise.reject(new MarketplaceConnectorError("timeout")), FAST),
    ).rejects.toThrow("timeout");

    expect((await stored(id)).account.connectionStatus).toBe("connected");
  });

  it("reconnectRequired não sobrescreve uma conta que foi desconectada no meio", async () => {
    const id = await createConnectedAccount("op-expirada-desconectada");

    await expect(
      runAccountOperation(
        id,
        async () => {
          await repo.markDisconnected(getDb(), id); // desconectou; ciphertext intacto
          throw new MarketplaceConnectorError("Reconecte a conta", { reconnectRequired: true });
        },
        FAST,
      ),
    ).rejects.toThrow();

    expect((await stored(id)).account.connectionStatus).toBe("disconnected");
  });

  it("nunca deixa a credencial ou os tokens vazarem em mensagens de erro do serviço", async () => {
    const id = await createConnectedAccount("op-sem-vazamento");
    const release = (await tryAcquireAccountLease(id, 60_000))!;

    const error = await runAccountOperation(id, async () => ({ value: 1 }), { waitMs: 60, pollMs: 15 }).then(
      () => new Error("deveria falhar"),
      (err: Error) => err,
    );
    await release();

    expect(error.message).not.toContain("ACESSO-VELHO");
    expect(error.message).not.toContain("REFRESH-VELHO");
    expect(error.message).not.toContain("segredo");
  });
});
