import { z } from "zod";

export const RoleEnum = z.enum(["admin", "operator", "viewer"]);
export const StatusEnum = z.enum(["active", "inactive", "blocked"]);

export const CreateUserSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório."),
  email: z
    .string()
    .email("Informe um e-mail válido.")
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8, "Senha deve ter ao menos 8 caracteres."),
  role: RoleEnum,
  // Regra da spec: todo usuário nasce active por padrão — este campo existe no formulário
  // para o caso raro de o admin já querer criar inactive/blocked, nunca é obrigatório.
  status: StatusEnum.optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    name: z.string().min(1).optional(),
    role: RoleEnum.optional(),
  })
  .refine((data) => data.name !== undefined || data.role !== undefined, {
    message: "Informe ao menos um campo para atualizar.",
  });
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export const UpdateStatusSchema = z.object({
  status: StatusEnum,
});
export type UpdateStatusInput = z.infer<typeof UpdateStatusSchema>;

export const UpdatePasswordSchema = z.object({
  password: z.string().min(8, "Senha deve ter ao menos 8 caracteres."),
});
export type UpdatePasswordInput = z.infer<typeof UpdatePasswordSchema>;

export const ListUsersQuerySchema = z.object({
  search: z.string().min(1).optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

/** Contrato de saída pública — nunca inclui `passwordHash`. */
export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: RoleEnum,
  status: StatusEnum,
  lastLoginAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string().nullable(),
});
export type UserOutput = z.infer<typeof UserSchema>;
