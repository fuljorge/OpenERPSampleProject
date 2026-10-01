import { z } from "zod";

/** 3–6 letras maiúsculas — normaliza (trim + uppercase) antes de validar o formato. */
export const CategoryCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3,6}$/, "Código deve ter de 3 a 6 letras maiúsculas."));

export const CreateCategorySchema = z.object({
  code: CategoryCodeSchema,
  name: z.string().min(1, "Nome é obrigatório."),
  department: z.string().min(1, "Departamento é obrigatório."),
});
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = z
  .object({
    name: z.string().min(1).optional(),
    department: z.string().min(1).optional(),
  })
  .refine((data) => data.name !== undefined || data.department !== undefined, {
    message: "Informe ao menos um campo para atualizar.",
  });
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;

export const UpdateCategoryStatusSchema = z.object({
  active: z.boolean(),
});
export type UpdateCategoryStatusInput = z.infer<typeof UpdateCategoryStatusSchema>;

export const ListCategoriesQuerySchema = z.object({
  // z.coerce.boolean() NÃO serve aqui: usa o construtor Boolean(), que trata qualquer string
  // não vazia (inclusive a literal "false") como true. Query string só chega como texto.
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});
export type ListCategoriesQuery = z.infer<typeof ListCategoriesQuerySchema>;

export const CategorySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  department: z.string(),
  active: z.boolean(),
  createdAt: z.date(),
});
export type CategoryOutput = z.infer<typeof CategorySchema>;
