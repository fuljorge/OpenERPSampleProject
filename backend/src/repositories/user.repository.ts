import { ObjectId, type Collection, type Db } from "mongodb";

export type UserRole = "admin" | "operator" | "viewer";
export type UserStatus = "active" | "inactive" | "blocked";

export interface UserDocument {
  _id: ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: ObjectId | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status?: UserStatus;
  createdBy?: string | null;
}

export interface UpdateUserProfileInput {
  name?: string;
  role?: UserRole;
}

export interface ListUsersOptions {
  search?: string;
}

function collection(db: Db): Collection<UserDocument> {
  return db.collection<UserDocument>("users");
}

function toUser(doc: UserDocument): User {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    email: doc.email,
    passwordHash: doc.passwordHash,
    role: doc.role,
    status: doc.status,
    lastLoginAt: doc.lastLoginAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: doc.createdBy ? doc.createdBy.toHexString() : null,
  };
}

/**
 * E-mail é sempre comparado e persistido em forma normalizada (trim + lowercase) — sem isso,
 * duas grafias do mesmo e-mail (ex.: geradas por um seed manual) seriam tratadas como contas
 * diferentes na busca exata do MongoDB.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Escapa metacaracteres de regex antes de usar um termo de busca vindo do usuário num `$regex`. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const userRepository = {
  async findByEmail(db: Db, email: string): Promise<User | null> {
    const doc = await collection(db).findOne({ email: normalizeEmail(email) });
    return doc ? toUser(doc) : null;
  },

  async findById(db: Db, id: string): Promise<User | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await collection(db).findOne({ _id: new ObjectId(id) });
    return doc ? toUser(doc) : null;
  },

  async findOneByRole(db: Db, role: UserRole): Promise<User | null> {
    const doc = await collection(db).findOne({ role });
    return doc ? toUser(doc) : null;
  },

  /** Busca por nome OU e-mail (case-insensitive); sem `search`, lista todos. */
  async list(db: Db, options: ListUsersOptions = {}): Promise<User[]> {
    const filter = options.search
      ? {
          $or: [
            { name: { $regex: escapeRegex(options.search), $options: "i" } },
            { email: { $regex: escapeRegex(options.search), $options: "i" } },
          ],
        }
      : {};
    const docs = await collection(db).find(filter).sort({ name: 1 }).toArray();
    return docs.map(toUser);
  },

  async create(db: Db, input: CreateUserInput): Promise<User> {
    const now = new Date();
    const doc: UserDocument = {
      _id: new ObjectId(),
      name: input.name,
      email: normalizeEmail(input.email),
      passwordHash: input.passwordHash,
      role: input.role,
      status: input.status ?? "active",
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy ? new ObjectId(input.createdBy) : null,
    };
    await collection(db).insertOne(doc);
    return toUser(doc);
  },

  /** Atualização parcial de nome/perfil — nunca e-mail (imutável nesta fase) nem senha/status. */
  async updateProfile(db: Db, id: string, input: UpdateUserProfileInput): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const patch: Partial<Pick<UserDocument, "name" | "role">> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.role !== undefined) patch.role = input.role;

    await collection(db).updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...patch, updatedAt: new Date() } },
    );
  },

  async updateStatus(db: Db, id: string, status: UserStatus): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
    );
  },

  async updatePassword(db: Db, id: string, passwordHash: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne(
      { _id: new ObjectId(id) },
      { $set: { passwordHash, updatedAt: new Date() } },
    );
  },

  async updateLastLogin(db: Db, id: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne(
      { _id: new ObjectId(id) },
      { $set: { lastLoginAt: new Date() } },
    );
  },
};
