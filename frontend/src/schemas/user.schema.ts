import { z } from "zod";

export const RoleEnum = z.enum(["admin", "operator", "viewer"]);
export const StatusEnum = z.enum(["active", "inactive", "blocked"]);

export const CreateUserFormSchema = z
  .object({
    name: z.string().min(1, "Nome é obrigatório."),
    email: z.string().email("Informe um e-mail válido."),
    password: z.string().min(8, "Senha deve ter ao menos 8 caracteres."),
    confirmPassword: z.string().min(1, "Confirme a senha."),
    role: RoleEnum,
    status: StatusEnum,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });
export type CreateUserFormValues = z.infer<typeof CreateUserFormSchema>;

export const EditUserFormSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório."),
  role: RoleEnum,
});
export type EditUserFormValues = z.infer<typeof EditUserFormSchema>;

/** Contrato de um usuário como retornado pela API (GET /users, POST /users etc.). */
export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: RoleEnum,
  status: StatusEnum,
  lastLoginAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  createdBy: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;
