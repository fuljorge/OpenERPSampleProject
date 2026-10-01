import { z } from "zod";

export const CategoryCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3,6}$/, "Código deve ter de 3 a 6 letras."));

export const CategorySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  department: z.string(),
  active: z.boolean(),
  createdAt: z.coerce.date(),
});
export type Category = z.infer<typeof CategorySchema>;

export const CreateCategoryFormSchema = z.object({
  code: CategoryCodeSchema,
  name: z.string().min(1, "Nome é obrigatório."),
  department: z.string().min(1, "Departamento é obrigatório."),
});
export type CreateCategoryFormValues = z.infer<typeof CreateCategoryFormSchema>;

export const EditCategoryFormSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório."),
  department: z.string().min(1, "Departamento é obrigatório."),
});
export type EditCategoryFormValues = z.infer<typeof EditCategoryFormSchema>;
