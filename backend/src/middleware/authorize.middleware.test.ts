import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { authorize } from "./authorize.middleware.js";

function makeReply() {
  const reply = {
    code: vi.fn(),
    send: vi.fn(),
  };
  reply.code.mockReturnValue(reply);
  reply.send.mockReturnValue(reply);
  return reply as unknown as FastifyReply & { code: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

describe("authorize", () => {
  it("permite passar quando o role do usuário está na lista permitida", async () => {
    const handler = authorize(["admin"]);
    const request = { user: { id: "1", name: "A", email: "a@x.com", role: "admin" } } as unknown as FastifyRequest;
    const reply = makeReply();

    await handler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("rejeita com 403 quando o role não está na lista permitida", async () => {
    const handler = authorize(["admin"]);
    const request = {
      user: { id: "1", name: "A", email: "a@x.com", role: "operator" },
    } as unknown as FastifyRequest;
    const reply = makeReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ success: false, error: "Acesso negado." });
  });

  it("rejeita com 403 para viewer quando só admin é permitido", async () => {
    const handler = authorize(["admin"]);
    const request = {
      user: { id: "1", name: "A", email: "a@x.com", role: "viewer" },
    } as unknown as FastifyRequest;
    const reply = makeReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it("rejeita com 403 quando não há request.user (defensivo — não deveria ocorrer após authenticate)", async () => {
    const handler = authorize(["admin"]);
    const request = {} as FastifyRequest;
    const reply = makeReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it("permite quando há múltiplos roles aceitos e o usuário tem um deles", async () => {
    const handler = authorize(["admin", "operator"]);
    const request = {
      user: { id: "1", name: "A", email: "a@x.com", role: "operator" },
    } as unknown as FastifyRequest;
    const reply = makeReply();

    await handler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });
});
