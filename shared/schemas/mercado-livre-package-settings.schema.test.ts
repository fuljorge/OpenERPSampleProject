import { describe, expect, it } from "vitest";
import { MercadoLivrePackageSettingsRecordSchema, MercadoLivrePackageSettingsSchema } from "./mercado-livre-package-settings.schema.js";

const VALID = { altura_cm: 10, largura_cm: 30, comprimento_cm: 40, peso_g: 300 };

describe("MercadoLivrePackageSettingsSchema (spec 012, seção 3.4; ADR-027)", () => {
  it("aceita dimensões e peso inteiros positivos", () => {
    expect(MercadoLivrePackageSettingsSchema.parse(VALID)).toEqual(VALID);
  });

  it("peso_g é sempre obrigatório (diferente do desenho antigo por env var)", () => {
    const { peso_g: _peso_g, ...withoutWeight } = VALID;
    expect(() => MercadoLivrePackageSettingsSchema.parse(withoutWeight)).toThrow();
  });

  it.each(["altura_cm", "largura_cm", "comprimento_cm", "peso_g"] as const)("%s decimal é rejeitado", (field) => {
    expect(() => MercadoLivrePackageSettingsSchema.parse({ ...VALID, [field]: 10.5 })).toThrow();
  });

  it.each(["altura_cm", "largura_cm", "comprimento_cm", "peso_g"] as const)("%s zero ou negativo é rejeitado", (field) => {
    expect(() => MercadoLivrePackageSettingsSchema.parse({ ...VALID, [field]: 0 })).toThrow();
    expect(() => MercadoLivrePackageSettingsSchema.parse({ ...VALID, [field]: -5 })).toThrow();
  });
});

describe("MercadoLivrePackageSettingsRecordSchema", () => {
  it("aceita o registro completo com metadados de auditoria", () => {
    const parsed = MercadoLivrePackageSettingsRecordSchema.parse({
      ...VALID,
      updatedAt: "2026-09-22T12:00:00.000Z",
      updatedBy: "admin-1",
    });
    expect(parsed.updatedAt).toBeInstanceOf(Date);
    expect(parsed.updatedBy).toBe("admin-1");
  });
});
