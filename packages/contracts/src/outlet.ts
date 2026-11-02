import { z } from "zod";

import { identifierSchema } from "./shared.ts";

export const outletSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1),
});

export type Outlet = z.infer<typeof outletSchema>;
