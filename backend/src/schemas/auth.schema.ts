import { z } from "zod";

export const LoginInputSchema = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.trim().toLowerCase()),
  // Só exige presença — a política de tamanho mínimo (8 chars) é regra de criação de conta
  // (002-usuarios), não de tentativa de login; validar isso aqui vazaria a política antes de
  // checar a credencial.
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const AuthMeOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(["admin", "operator", "viewer"]),
});
export type AuthMeOutput = z.infer<typeof AuthMeOutputSchema>;
