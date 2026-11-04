import { z } from "zod";

import { identifierSchema } from "./shared.ts";
import { stockReportItemSchema } from "./stock-report.ts";
import { visitSchema } from "./visit.ts";

// A fresh UUID per logical submission, retained across retries.
export const idempotencyKeySchema = z.uuid();

const items = z
  .array(stockReportItemSchema.strict())
  .min(1)
  .max(100)
  .refine(
    (rows) => new Set(rows.map((row) => row.productId)).size === rows.length,
    "Duplicate Product IDs"
  );

const timestamp = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => Number.isFinite(new Date(value).getTime()),
    "Invalid timestamp"
  )
  .transform((value) => new Date(value).toISOString());

export const visitStockReportInputSchema = z.strictObject({
  reportedAt: timestamp,
  items,
});

export const createVisitSchema = z.strictObject({
  outletId: identifierSchema,
  visitedAt: timestamp,
  notes: visitSchema.shape.notes,
  followUp: visitSchema.shape.followUp,
  stockReport: visitStockReportInputSchema.optional(),
});

export const createStockReportSchema = z.strictObject({
  outletId: identifierSchema,
  visitId: identifierSchema.optional(),
  reportedAt: timestamp,
  items,
});

export type CreateVisit = z.infer<typeof createVisitSchema>;
export type CreateStockReport = z.infer<typeof createStockReportSchema>;
