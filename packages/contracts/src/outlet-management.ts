import { z } from "zod";

import { webOperationIdSchema } from "./identity.ts";
import {
  createOutletSchema,
  planningIdSchema,
  updateOutletSchema,
} from "./planning.ts";

// Extend existing Outlet rules, not the Bot protocol. Stored CAS values stay exact.
export const webCreateOutletSchema = createOutletSchema
  .extend({
    operationId: webOperationIdSchema,
  })
  .strict();
export const webUpdateOutletSchema = z
  .object({
    operationId: webOperationIdSchema,
    id: planningIdSchema,
    name: z.string(),
    noRs: z.string().optional(),
    expectedName: z.string(),
    expectedNoRs: z.string().nullable(),
  })
  .strict()
  .transform((input, ctx) => {
    const result = updateOutletSchema.safeParse({
      id: input.id,
      name: input.name,
      ...(input.noRs !== undefined ? { noRs: input.noRs } : {}),
    });
    if (!result.success) {
      ctx.addIssue({ code: "custom", message: "Invalid Outlet update" });
      return z.NEVER;
    }
    return { ...input, name: result.data.name, noRs: result.data.noRs };
  });
export const webDeleteOutletSchema = z
  .object({
    operationId: webOperationIdSchema,
    id: planningIdSchema,
  })
  .strict();
