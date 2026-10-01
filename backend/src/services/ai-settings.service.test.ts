import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSettingsRecord as AiSettingsRepoRecord } from "../repositories/ai-settings.repository.js";

const findMock = vi.fn();
const upsertMock = vi.fn();
const recordMock = vi.fn();
const encryptMock = vi.fn();
const decryptMock = vi.fn();
const maskMock = vi.fn();

vi.mock("../repositories/ai-settings.repository.js", () => ({
  aiSettingsRepository: {
    find: (...args: unknown[]) => findMock(...args),
    upsert: (...args: unknown[]) => upsertMock(...args),
  },
}));

vi.mock("./audit-log.service.js", () => ({
  record: (...args: unknown[]) => recordMock(...args),
}));

vi.mock("./credential-encryption.service.js", () => ({
  encryptCredential: (...args: unknown[]) => encryptMock(...args),
  decryptCredential: (...args: unknown[]) => decryptMock(...args),
  maskCredential: (...args: unknown[]) => maskMock(...args),
}));

vi.mock("../database/mongo.client.js", () => ({
  getDb: () => ({}),
}));

const { getAiSettings, getAiSettingsForDisplay, updateAiSettings, AiSettingsIncompleteError } = await import("./ai-settings.service.js");

function fakeRecord(overrides: Partial<AiSettingsRepoRecord> = {}): AiSettingsRepoRecord {
  return {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    apiKey: "k1:iv:tag:dados",
    apiKeyPreview: "****9f3a",
    updatedAt: new Date("2026-09-24T18:40:00.000Z"),
    updatedBy: "admin-1",
    ...overrides,
  };
}

beforeEach(() => {
  findMock.mockReset();
  upsertMock.mockReset();
  recordMock.mockReset();
  encryptMock.mockReset();
  decryptMock.mockReset();
  maskMock.mockReset();
});

describe("ai-settings.service.getAiSettings (spec 013)", () => {
  it("sem configuração salva: null", async () => {
    findMock.mockResolvedValue(null);
    expect(await getAiSettings()).toBeNull();
    expect(decryptMock).not.toHaveBeenCalled();
  });

  it("decifra a apiKey (roundtrip com credential-encryption.service.ts)", async () => {
    findMock.mockResolvedValue(fakeRecord());
    decryptMock.mockResolvedValue("sk-plain-value");

    const result = await getAiSettings();

    expect(decryptMock).toHaveBeenCalledWith("k1:iv:tag:dados");
    expect(result).toEqual({ baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", apiKey: "sk-plain-value" });
  });
});

describe("ai-settings.service.getAiSettingsForDisplay (spec 013)", () => {
  it("nunca inclui apiKey nem o ciphertext — só o preview mascarado", async () => {
    findMock.mockResolvedValue(fakeRecord());
    const result = await getAiSettingsForDisplay();
    expect(result).not.toHaveProperty("apiKey");
    expect(result?.apiKeyPreview).toBe("****9f3a");
  });

  it("sem configuração salva: null", async () => {
    findMock.mockResolvedValue(null);
    expect(await getAiSettingsForDisplay()).toBeNull();
  });
});

describe("ai-settings.service.updateAiSettings (spec 013)", () => {
  it("primeira configuração sem apiKey: rejeita sem gravar nada", async () => {
    findMock.mockResolvedValue(null);
    await expect(updateAiSettings({ baseUrl: "https://x.test" }, "admin-1")).rejects.toBeInstanceOf(AiSettingsIncompleteError);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("primeira configuração sem model: rejeita sem gravar nada", async () => {
    findMock.mockResolvedValue(null);
    await expect(updateAiSettings({ apiKey: "sk-abc" }, "admin-1")).rejects.toBeInstanceOf(AiSettingsIncompleteError);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("primeira configuração completa: cifra a chave e grava", async () => {
    findMock.mockResolvedValue(null);
    encryptMock.mockResolvedValue("k1:iv:tag:novo");
    maskMock.mockReturnValue("****abcd");
    upsertMock.mockResolvedValue(fakeRecord({ apiKey: "k1:iv:tag:novo", apiKeyPreview: "****abcd" }));

    const result = await updateAiSettings({ baseUrl: "https://x.test", model: "gpt-4o-mini", apiKey: "sk-abcd" }, "admin-1");

    expect(encryptMock).toHaveBeenCalledWith("sk-abcd");
    expect(upsertMock).toHaveBeenCalledWith(
      {},
      { baseUrl: "https://x.test", model: "gpt-4o-mini", apiKey: "k1:iv:tag:novo", apiKeyPreview: "****abcd" },
      "admin-1",
    );
    expect(result).not.toHaveProperty("apiKey");
  });

  it("achado real: primeira configuração sem baseUrl grava string vazia, nunca undefined (senão o campo some do documento)", async () => {
    findMock.mockResolvedValue(null);
    encryptMock.mockResolvedValue("k1:iv:tag:novo");
    maskMock.mockReturnValue("****abcd");
    upsertMock.mockResolvedValue(fakeRecord({ baseUrl: "", apiKey: "k1:iv:tag:novo", apiKeyPreview: "****abcd" }));

    await updateAiSettings({ model: "gpt-4o-mini", apiKey: "sk-abcd" }, "admin-1");

    expect(upsertMock).toHaveBeenCalledWith({}, expect.objectContaining({ baseUrl: "" }), "admin-1");
  });

  it("apiKey omitida numa edição: mantém o valor cifrado atual (não re-cifra, não perde)", async () => {
    findMock.mockResolvedValue(fakeRecord());
    upsertMock.mockResolvedValue(fakeRecord({ model: "gpt-4o" }));

    await updateAiSettings({ model: "gpt-4o" }, "admin-1");

    expect(encryptMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith({}, { baseUrl: undefined, model: "gpt-4o", apiKey: undefined, apiKeyPreview: undefined }, "admin-1");
  });

  it("auditoria nunca recebe a chave — só um booleano dizendo se ela mudou", async () => {
    findMock.mockResolvedValue(fakeRecord());
    upsertMock.mockResolvedValue(fakeRecord({ model: "gpt-4o" }));

    await updateAiSettings({ model: "gpt-4o" }, "admin-1");

    expect(recordMock).toHaveBeenCalledWith(
      "AI_SETTINGS_UPDATE",
      "ai_settings",
      "default",
      "admin-1",
      expect.objectContaining({ apiKeyChanged: false }),
    );
    const metadata = recordMock.mock.calls[0]?.[4] as Record<string, unknown>;
    expect(JSON.stringify(metadata)).not.toContain("sk-");
    expect(JSON.stringify(metadata)).not.toContain("9f3a");
  });
});
