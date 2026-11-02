import { z } from "zod";

import { identifierSchema } from "./shared.ts";

export const salesForceSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1),
});

export type SalesForce = z.infer<typeof salesForceSchema>;
