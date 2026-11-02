import { z } from "zod";

import { identifierSchema } from "./shared.ts";

export const productSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1),
});

export type Product = z.infer<typeof productSchema>;
