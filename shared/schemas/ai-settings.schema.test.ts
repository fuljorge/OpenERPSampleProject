import { describe, expect, it } from "vitest";
import { AiSettingsInputSchema, AiSettingsRecordSchema } from "./ai-settings.schema.js";

describe("AiSettingsInputSchema (spec 013)", () => {
  it("aceita objeto vazio — todos os campos são opcionais neste schema (obrigatoriedade é regra dinâmica do service)", () => {
    expect(AiSettingsInputSchema.parse({})).toEqual({});
  });

  it("aceita os três campos juntos", () => {
    const input = { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", apiKey: "sk-abc123" };
    expect(AiSettingsInputSchema.parse(input)).toEqual(input);
  });

  it("rejeita string vazia em qualquer campo (usar omissão, não string vazia, pra 'não alterar')", () => {
    expect(() => AiSettingsInputSchema.parse({ apiKey: "" })).toThrow();
    expect(() => AiSettingsInputSchema.parse({ model: "" })).toThrow();
  });

  it("rejeita campo desconhecido (.strict())", () => {
    expect(() => AiSettingsInputSchema.parse({ apiKey: "sk-abc123", extra: "x" })).toThrow();
  });
});

describe("AiSettingsRecordSchema (spec 013)", () => {
  const VALID_RECORD = {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    apiKeyPreview: "****9f3a",
    updatedAt: "2026-09-24T18:40:00.000Z",
    updatedBy: "admin-1",
  };

  it("aceita o registro completo", () => {
    const parsed = AiSettingsRecordSchema.parse(VALID_RECORD);
    expect(parsed.updatedAt).toBeInstanceOf(Date);
    expect(parsed.apiKeyPreview).toBe("****9f3a");
  });

  it("nunca aceita apiKey (cifrada ou não) — defesa estrutural contra vazamento por engano (.strict())", () => {
    expect(() => AiSettingsRecordSchema.parse({ ...VALID_RECORD, apiKey: "sk-abc123" })).toThrow();
  });
});
