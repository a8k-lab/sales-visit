import { z } from "zod";

import { identifierSchema, submissionChannelSchema } from "./shared.ts";

// A Visit records its outcome; it does not require a Stock Report.
export const visitSchema = z.object({
  id: identifierSchema,
  outletId: identifierSchema,
  salesForceId: identifierSchema,
  visitedAt: z.iso.datetime({ offset: true }),
  submissionChannel: submissionChannelSchema,
  notes: z.string().optional(),
  followUp: z.string().optional(),
});

export type Visit = z.infer<typeof visitSchema>;
