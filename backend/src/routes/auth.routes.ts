import type { FastifyInstance, FastifyReply } from "fastify";
import { AuthMeOutputSchema, LoginInputSchema } from "../schemas/auth.schema.js";
import {
  ACCESS_COOKIE_NAME,
  InvalidCredentialsError,
  REFRESH_COOKIE_NAME,
  issueTokens,
  refresh,
  verifyCredentials,
} from "../services/auth.service.js";

const ACCESS_COOKIE_MAX_AGE = 60 * 60; // 1 hora, em segundos — precisa bater com ACCESS_TOKEN_TTL (auth.service.ts)
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 dias, em segundos

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

function setSessionCookies(
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken: string },
): void {
  reply
    .setCookie(ACCESS_COOKIE_NAME, tokens.accessToken, cookieOptions(ACCESS_COOKIE_MAX_AGE))
    .setCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, cookieOptions(REFRESH_COOKIE_MAX_AGE));
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/login",
    {
      // Endurece o limite global (rate-limit.plugin.ts) especificamente aqui, mitigando
      // brute force (constituição, princípio VII).
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parseResult = LoginInputSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ success: false, error: "Dados de login inválidos." });
      }

      try {
        const user = await verifyCredentials(parseResult.data.email, parseResult.data.password);
        const tokens = issueTokens(user);
        setSessionCookies(reply, tokens);
        return { success: true, data: user };
      } catch (err) {
        if (err instanceof InvalidCredentialsError) {
          return reply.code(401).send({ success: false, error: err.message });
        }
        throw err;
      }
    },
  );

  fastify.post("/logout", async (_request, reply) => {
    reply.clearCookie(ACCESS_COOKIE_NAME, { path: "/" }).clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
    return { success: true };
  });

  fastify.post("/refresh", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    if (!token) {
      return reply.code(401).send({ success: false, error: "Não autenticado." });
    }

    try {
      const tokens = await refresh(token);
      setSessionCookies(reply, tokens);
      return { success: true };
    } catch {
      return reply.code(401).send({ success: false, error: "Sessão expirada." });
    }
  });

  fastify.get("/me", { preHandler: fastify.authenticate }, async (request) => {
    // .parse (não safeParse): se request.user divergir do contrato aqui, é um bug real que
    // deve estourar alto, não passar batido como um 200 com formato errado.
    return { success: true, data: AuthMeOutputSchema.parse(request.user) };
  });
}
