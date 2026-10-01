import { z } from "zod";

export const SkuSchema = z
  .string()
  .regex(/^ERP-[A-Z]{3,6}-\d{6}$/, "SKU em formato inválido (esperado ERP-CATEGORIA-000000).");
export type Sku = z.infer<typeof SkuSchema>;
