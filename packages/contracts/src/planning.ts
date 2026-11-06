import { z } from "zod";

import {
  telegramIdSchema as telegramUserIdSchema,
  type BotActor,
} from "./identity.ts";
import { outletSchema } from "./outlet.ts";

// Bounded opaque operation inputs, not business codes or Telegram identities.
const printable = (value: string) =>
  [...value].every(
    (char) =>
      char.charCodeAt(0) >= 32 &&
      (char.charCodeAt(0) < 127 || char.charCodeAt(0) > 159)
  );
// Validate blankness without normalizing opaque stored keys or page cursors.
const storedPlanningIdSchema = z.string().refine((id) => id.trim().length > 0);
export const planningIdSchema = storedPlanningIdSchema
  .max(256)
  .refine(printable);
const nameSchema = z
  .string()
  .refine(printable)
  .refine((value) => !/\p{Cf}/u.test(value))
  .trim()
  .min(1)
  .max(256);
// Stored epoch milliseconds may predate 1970; never normalize legacy values.
const timestampSchema = z.number().int().safe();
// Private business metadata only; outletSchema remains the public projection.
export const outletBusinessIdSchema = planningIdSchema.refine(
  (value) => !/[\p{Cc}\p{Cf}]/u.test(value)
);
export const outletDetailSchema = outletSchema.extend({
  id: storedPlanningIdSchema,
  businessId: z.string().nullable(),
  noRs: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema.nullable(),
});
export type OutletDetail = z.infer<typeof outletDetailSchema>;
export const createOutletSchema = z
  .object({
    name: nameSchema,
    businessId: outletBusinessIdSchema,
    noRs: outletBusinessIdSchema,
  })
  .strict();
// Exactly one explicit namespace. No automatic fallback or dual-key guessing.
export const outletKeySchema = z.union([
  z.object({ id: planningIdSchema }).strict(),
  z.object({ businessId: outletBusinessIdSchema }).strict(),
]);
export const updateOutletSchema = z.union([
  z
    .object({
      id: planningIdSchema,
      name: nameSchema,
      noRs: outletBusinessIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      businessId: outletBusinessIdSchema,
      name: nameSchema,
      noRs: outletBusinessIdSchema,
    })
    .strict(),
]);
export const outletListSchema = z
  .object({ after: planningIdSchema.optional() })
  .strict();
export type CreateOutlet = z.infer<typeof createOutletSchema>;
export type UpdateOutlet = z.infer<typeof updateOutletSchema>;

// ISO weekdays, independent of JavaScript Date.getDay() (Sunday=0).
export const weekdaySchema = z.number().int().min(1).max(7);
export const indonesianWeekdays = [
  "senin",
  "selasa",
  "rabu",
  "kamis",
  "jumat",
  "sabtu",
  "minggu",
] as const;
export const indonesianWeekdaySchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(indonesianWeekdays))
  .transform((day) => indonesianWeekdays.indexOf(day) + 1)
  .pipe(weekdaySchema);
export const visitScheduleSchema = z.object({
  id: storedPlanningIdSchema,
  salesForceId: storedPlanningIdSchema,
  outletId: storedPlanningIdSchema,
  weekday: weekdaySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type VisitSchedule = z.infer<typeof visitScheduleSchema>;
export const scheduleDetailSchema = visitScheduleSchema.extend({
  outletName: z.string(),
  salesForceName: z.string(),
  outletBusinessId: z.string().nullable(),
  outletNoRs: z.string().nullable(),
  telegramUserId: telegramUserIdSchema.nullable(),
});
export type ScheduleDetail = z.infer<typeof scheduleDetailSchema>;
export const createScheduleSchema = z
  .object({
    salesForceId: planningIdSchema,
    outletId: planningIdSchema,
    weekday: weekdaySchema,
  })
  .strict();
export type CreateSchedule = z.infer<typeof createScheduleSchema>;
export const ownScheduleFilterSchema = z
  .object({
    weekday: weekdaySchema.optional(),
    after: planningIdSchema.optional(),
  })
  .strict();
export const scheduleFilterSchema = ownScheduleFilterSchema
  .extend({
    salesForceId: planningIdSchema.optional(),
    telegramUserId: telegramUserIdSchema.max(256).optional(),
  })
  .refine(
    (filter) =>
      !(
        filter.salesForceId !== undefined && filter.telegramUserId !== undefined
      )
  );
export type OwnScheduleFilter = z.infer<typeof ownScheduleFilterSchema>;
export type ScheduleFilter = z.infer<typeof scheduleFilterSchema>;
export type PlanningResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code:
        | "invalid"
        | "forbidden"
        | "not_found"
        | "referenced"
        | "duplicate"
        | "reference_not_found"
        | "association_unavailable"
        | "unavailable";
    };
export type PlanningPage<T> = { items: T[]; next: string | null };

// Extends the existing named BotIdentity capability; never an HTTP interface.
export interface BotPlanningService {
  listOutlets(
    actor: BotActor,
    input?: unknown
  ): Promise<PlanningResult<PlanningPage<OutletDetail>>>;
  getOutlet(
    actor: BotActor,
    input: unknown
  ): Promise<PlanningResult<OutletDetail>>;
  createOutlet(
    actor: BotActor,
    input: unknown
  ): Promise<PlanningResult<OutletDetail>>;
  updateOutlet(
    actor: BotActor,
    input: unknown
  ): Promise<PlanningResult<OutletDetail>>;
  deleteOutlet(
    actor: BotActor,
    input: unknown
  ): Promise<PlanningResult<OutletDetail>>;
  ownSchedule(
    actor: BotActor,
    input?: unknown
  ): Promise<PlanningResult<PlanningPage<ScheduleDetail>>>;
  listSchedules(
    actor: BotActor,
    input?: unknown
  ): Promise<PlanningResult<PlanningPage<ScheduleDetail>>>;
  createSchedule(
    actor: BotActor,
    input: unknown
  ): Promise<PlanningResult<VisitSchedule>>;
}
