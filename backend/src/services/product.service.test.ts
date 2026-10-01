import { describe, expect, it } from "vitest";
import { isValidStatusTransition } from "./product.service.js";

describe("product.service.isValidStatusTransition", () => {
  it("aceita o fluxo normal completo (spec 005, seção 3)", () => {
    expect(isValidStatusTransition("rascunho", "em_revisao")).toBe(true);
    expect(isValidStatusTransition("em_revisao", "disponivel")).toBe(true);
    expect(isValidStatusTransition("disponivel", "reservado")).toBe(true);
    expect(isValidStatusTransition("reservado", "vendido")).toBe(true);
  });

  it("rejeita vendido → rascunho (transição inválida, não pode voltar do fim do fluxo)", () => {
    expect(isValidStatusTransition("vendido", "rascunho")).toBe(false);
  });

  it("rejeita pular etapas sem passar pelas intermediárias (ex.: rascunho → reservado)", () => {
    expect(isValidStatusTransition("rascunho", "reservado")).toBe(false);
    expect(isValidStatusTransition("rascunho", "vendido")).toBe(false);
  });

  it("aceita inativo a partir de qualquer estado (spec: exclusão lógica sempre alcançável)", () => {
    expect(isValidStatusTransition("rascunho", "inativo")).toBe(true);
    expect(isValidStatusTransition("em_revisao", "inativo")).toBe(true);
    expect(isValidStatusTransition("disponivel", "inativo")).toBe(true);
    expect(isValidStatusTransition("reservado", "inativo")).toBe(true);
    expect(isValidStatusTransition("vendido", "inativo")).toBe(true);
  });

  it("mesmo estado para o mesmo estado é um no-op válido", () => {
    expect(isValidStatusTransition("disponivel", "disponivel")).toBe(true);
  });

  it("inativo só pode ser reativado para rascunho (reinicia o fluxo)", () => {
    expect(isValidStatusTransition("inativo", "rascunho")).toBe(true);
    expect(isValidStatusTransition("inativo", "disponivel")).toBe(false);
  });
});
