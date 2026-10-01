import { describe, expect, it } from "vitest";
import { matchesExpectedUser } from "./mercado-livre-user-match.js";

const user = { id: 1234567890, nickname: "OpenErpSampleSalesML" };

describe("matchesExpectedUser (spec 012, seção 2.5)", () => {
  it("apelido igual confere, sem diferenciar maiúsculas de minúsculas", () => {
    expect(matchesExpectedUser("OpenErpSampleSalesML", user)).toBe(true);
    expect(matchesExpectedUser("openerpsamplesalesml", user)).toBe(true);
    expect(matchesExpectedUser("OPENERPSAMPLESALESML", user)).toBe(true);
  });

  it("ignora espaços nas pontas e um @ inicial", () => {
    expect(matchesExpectedUser("  @OpenErpSampleSalesML  ", user)).toBe(true);
  });

  it("só dígitos é comparado com o ID (número ou texto)", () => {
    expect(matchesExpectedUser("1234567890", user)).toBe(true);
    expect(matchesExpectedUser("1234567890", { id: "1234567890", nickname: "outro" })).toBe(true);
    expect(matchesExpectedUser("3692153318", user)).toBe(false);
  });

  it("dígitos nunca são comparados com o apelido, nem o apelido com o ID", () => {
    expect(matchesExpectedUser("123", { id: 999, nickname: "123" })).toBe(false);
    expect(matchesExpectedUser("OpenErpSampleSalesML", { id: "OpenErpSampleSalesML" })).toBe(false);
  });

  it("apelido diferente ou parcial não confere", () => {
    expect(matchesExpectedUser("OutraLoja", user)).toBe(false);
    expect(matchesExpectedUser("OpenErpSample", user)).toBe(false);
    expect(matchesExpectedUser("OpenErpSampleSalesML2", user)).toBe(false);
  });

  it("usuário sem apelido só confere por ID", () => {
    expect(matchesExpectedUser("QualquerApelido", { id: 1, nickname: undefined })).toBe(false);
    expect(matchesExpectedUser("1", { id: 1 })).toBe(true);
  });

  it("esperado vazio não restringe nada", () => {
    expect(matchesExpectedUser("   ", user)).toBe(true);
  });
});
