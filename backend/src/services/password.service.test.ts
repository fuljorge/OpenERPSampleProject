import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.service.js";

describe("password.service", () => {
  it("hashPassword gera um valor diferente da senha original", async () => {
    const hash = await hashPassword("senha-correta-123");
    expect(hash).not.toBe("senha-correta-123");
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it("verifyPassword aceita a senha correta", async () => {
    const hash = await hashPassword("senha-correta-123");
    await expect(verifyPassword(hash, "senha-correta-123")).resolves.toBe(true);
  });

  it("verifyPassword rejeita a senha incorreta", async () => {
    const hash = await hashPassword("senha-correta-123");
    await expect(verifyPassword(hash, "senha-errada")).resolves.toBe(false);
  });
});
