import { z } from "zod";

export const LoginFormSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});
export type LoginFormValues = z.infer<typeof LoginFormSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(["admin", "operator", "viewer"]),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;
