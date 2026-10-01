import jwt from "jsonwebtoken";
import { getDb } from "../database/mongo.client.js";
import { userRepository, type UserRole } from "../repositories/user.repository.js";
import { record } from "./audit-log.service.js";
import { verifyPassword } from "./password.service.js";

const ACCESS_TOKEN_TTL = "1h";
const REFRESH_TOKEN_TTL = "7d";

export const ACCESS_COOKIE_NAME = "accessToken";
export const REFRESH_COOKIE_NAME = "refreshToken";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  name: string;
  email: string;
}

interface RefreshTokenPayload {
  sub: string;
}

/**
 * Erro único e genérico para qualquer falha de autenticação — nunca revela se o e-mail
 * existe, se a senha está errada ou se a conta está inativa/bloqueada (constituição,
 * princípio VII; spec 001, seção 6).
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("E-mail ou senha inválidos.");
    this.name = "InvalidCredentialsError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
}

function toAuthenticatedUser(user: { id: string; name: string; email: string; role: UserRole }): AuthenticatedUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function verifyCredentials(email: string, password: string): Promise<AuthenticatedUser> {
  const db = getDb();
  const user = await userRepository.findByEmail(db, email);

  if (!user || user.status !== "active") {
    await record("LOGIN_FAILED", "user", user?.id, user?.id);
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await verifyPassword(user.passwordHash, password);
  if (!passwordMatches) {
    await record("LOGIN_FAILED", "user", user.id, user.id);
    throw new InvalidCredentialsError();
  }

  // As duas escritas são independentes entre si e nenhuma delas pode bloquear o login: record()
  // já engole seus próprios erros (ver audit-log.service.ts); updateLastLogin é só um timestamp
  // de conveniência, não um requisito de autenticação — uma falha transitória aqui não deve
  // derrubar um login com credenciais corretas.
  await Promise.all([
    record("LOGIN_SUCCESS", "user", user.id, user.id),
    userRepository.updateLastLogin(db, user.id).catch((err: unknown) => {
      console.error("Falha ao atualizar lastLoginAt:", err);
    }),
  ]);

  return toAuthenticatedUser(user);
}

export function issueTokens(user: AuthenticatedUser): AuthTokens {
  const accessPayload: AccessTokenPayload = {
    sub: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  };
  const refreshPayload: RefreshTokenPayload = { sub: user.id };

  const accessToken = jwt.sign(accessPayload, requireEnv("JWT_ACCESS_SECRET"), {
    expiresIn: ACCESS_TOKEN_TTL,
  });
  const refreshToken = jwt.sign(refreshPayload, requireEnv("JWT_REFRESH_SECRET"), {
    expiresIn: REFRESH_TOKEN_TTL,
  });

  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): AuthenticatedUser {
  const payload = jwt.verify(token, requireEnv("JWT_ACCESS_SECRET")) as AccessTokenPayload;
  return { id: payload.sub, role: payload.role, name: payload.name, email: payload.email };
}

/**
 * Rotação simples: a cada uso do refresh token, reemite os dois tokens (access + refresh).
 * Sem Redis/lista de revogação nesta fase (constituição, princípio V) — ver plan.md, seção 7.
 */
export async function refresh(refreshToken: string): Promise<AuthTokens> {
  let payload: RefreshTokenPayload;
  try {
    payload = jwt.verify(refreshToken, requireEnv("JWT_REFRESH_SECRET")) as RefreshTokenPayload;
  } catch {
    throw new InvalidCredentialsError();
  }

  const db = getDb();
  const user = await userRepository.findById(db, payload.sub);
  if (!user || user.status !== "active") {
    throw new InvalidCredentialsError();
  }

  return issueTokens(toAuthenticatedUser(user));
}
