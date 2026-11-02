import { z } from "zod";

import { identifierSchema, submissionChannelSchema } from "./shared.ts";

export const stockReportItemSchema = z.object({
  productId: identifierSchema,
  quantity: z.number().int().nonnegative(),
});

export type StockReportItem = z.infer<typeof stockReportItemSchema>;

export const stockReportSchema = z.object({
  id: identifierSchema,
  outletId: identifierSchema,
  reporterSalesForceId: identifierSchema,
  reportedAt: z.iso.datetime({ offset: true }),
  submissionChannel: submissionChannelSchema,
  visitId: identifierSchema.optional(),
  items: z.array(stockReportItemSchema).min(1),
});

export type StockReport = z.infer<typeof stockReportSchema>;
