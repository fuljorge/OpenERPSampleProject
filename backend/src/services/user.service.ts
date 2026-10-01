import { getDb } from "../database/mongo.client.js";
import {
  userRepository,
  type User,
  type UserRole,
  type UserStatus,
} from "../repositories/user.repository.js";
import { record } from "./audit-log.service.js";
import { hashPassword } from "./password.service.js";

const MIN_PASSWORD_LENGTH = 8;

export class EmailAlreadyExistsError extends Error {
  constructor() {
    super("Já existe um usuário com este e-mail.");
    this.name = "EmailAlreadyExistsError";
  }
}

export class WeakPasswordError extends Error {
  constructor() {
    super(`A senha deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    this.name = "WeakPasswordError";
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super("Usuário não encontrado.");
    this.name = "UserNotFoundError";
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 11000;
}

export interface CreateUserServiceInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  status?: UserStatus;
  actingAdminId: string;
}

export async function createUser(input: CreateUserServiceInput): Promise<User> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError();
  }

  const db = getDb();

  // Checagem prévia para dar um erro de negócio claro no caminho feliz; a garantia real
  // contra corrida é o índice único em `users.email` (ver mongo.client.ts, ensureIndexes) —
  // por isso o catch abaixo também trata erro de chave duplicada.
  const existing = await userRepository.findByEmail(db, input.email);
  if (existing) {
    throw new EmailAlreadyExistsError();
  }

  const passwordHash = await hashPassword(input.password);

  let user: User;
  try {
    user = await userRepository.create(db, {
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
      status: input.status ?? "active",
      createdBy: input.actingAdminId,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new EmailAlreadyExistsError();
    }
    throw err;
  }

  await record("USER_CREATE", "user", user.id, input.actingAdminId, {
    email: user.email,
    role: user.role,
  });

  return user;
}

export async function listUsers(search?: string): Promise<User[]> {
  const db = getDb();
  return userRepository.list(db, { search });
}

export async function getUserById(id: string): Promise<User> {
  const db = getDb();
  const user = await userRepository.findById(db, id);
  if (!user) throw new UserNotFoundError();
  return user;
}

export async function updateUserProfile(
  id: string,
  input: { name?: string; role?: UserRole },
  actingAdminId: string,
): Promise<User> {
  const db = getDb();
  const before = await userRepository.findById(db, id);
  if (!before) throw new UserNotFoundError();

  await userRepository.updateProfile(db, id, input);
  const after = await getUserById(id);

  await record("USER_UPDATE", "user", id, actingAdminId, {
    ...(input.name !== undefined ? { name: { oldValue: before.name, newValue: after.name } } : {}),
    ...(input.role !== undefined ? { role: { oldValue: before.role, newValue: after.role } } : {}),
  });

  return after;
}

export async function updateUserStatus(
  id: string,
  status: UserStatus,
  actingAdminId: string,
): Promise<User> {
  const db = getDb();
  const before = await userRepository.findById(db, id);
  if (!before) throw new UserNotFoundError();

  await userRepository.updateStatus(db, id, status);

  // Sem ação dedicada de "reativar" no enum de auditoria (008) — status != active usa
  // USER_DISABLE (o caso que a spec de auditoria nomeia explicitamente), qualquer outra
  // transição (incluindo voltar a active) usa USER_UPDATE.
  const action = status === "active" ? "USER_UPDATE" : "USER_DISABLE";
  await record(action, "user", id, actingAdminId, { oldValue: before.status, newValue: status });

  return getUserById(id);
}

export async function updateUserPassword(
  id: string,
  newPassword: string,
  actingAdminId: string,
): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError();
  }

  const db = getDb();
  const user = await userRepository.findById(db, id);
  if (!user) throw new UserNotFoundError();

  const passwordHash = await hashPassword(newPassword);
  await userRepository.updatePassword(db, id, passwordHash);

  await record("USER_UPDATE", "user", id, actingAdminId, { field: "password" });
}
