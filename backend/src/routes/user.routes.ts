import type { FastifyInstance } from "fastify";
import { authorize } from "../middleware/authorize.middleware.js";
import {
  CreateUserSchema,
  ListUsersQuerySchema,
  UpdatePasswordSchema,
  UpdateStatusSchema,
  UpdateUserSchema,
  UserSchema,
} from "../schemas/user.schema.js";
import {
  EmailAlreadyExistsError,
  UserNotFoundError,
  WeakPasswordError,
  createUser,
  getUserById,
  listUsers,
  updateUserPassword,
  updateUserProfile,
  updateUserStatus,
} from "../services/user.service.js";

export default async function userRoutes(fastify: FastifyInstance) {
  // Todo o módulo é restrito a admin (spec 002, seção 7) — authenticate primeiro, depois
  // authorize, nessa ordem, em toda rota.
  const guard = { preHandler: [fastify.authenticate, authorize(["admin"])] };

  fastify.get("/", guard, async (request, reply) => {
    const parseResult = ListUsersQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Parâmetros de busca inválidos." });
    }

    const users = await listUsers(parseResult.data.search);
    return { success: true, data: users.map((user) => UserSchema.parse(user)) };
  });

  fastify.get<{ Params: { id: string } }>("/:id", guard, async (request, reply) => {
    try {
      const user = await getUserById(request.params.id);
      return { success: true, data: UserSchema.parse(user) };
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.post("/", guard, async (request, reply) => {
    const parseResult = CreateUserSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dados de usuário inválidos." });
    }

    try {
      const user = await createUser({
        ...parseResult.data,
        actingAdminId: request.user!.id,
      });
      return reply.code(201).send({ success: true, data: UserSchema.parse(user) });
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError || err instanceof WeakPasswordError) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: string } }>("/:id", guard, async (request, reply) => {
    const parseResult = UpdateUserSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dados de atualização inválidos." });
    }

    try {
      const user = await updateUserProfile(request.params.id, parseResult.data, request.user!.id);
      return { success: true, data: UserSchema.parse(user) };
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: string } }>("/:id/status", guard, async (request, reply) => {
    const parseResult = UpdateStatusSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Status inválido." });
    }

    try {
      const user = await updateUserStatus(request.params.id, parseResult.data.status, request.user!.id);
      return { success: true, data: UserSchema.parse(user) };
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: string } }>("/:id/password", guard, async (request, reply) => {
    const parseResult = UpdatePasswordSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Senha inválida." });
    }

    try {
      await updateUserPassword(request.params.id, parseResult.data.password, request.user!.id);
      return { success: true };
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      if (err instanceof WeakPasswordError) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });
}
