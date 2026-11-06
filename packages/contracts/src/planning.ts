import { z } from "zod";

import type { BotActor } from "./identity.ts";
import { outletSchema } from "./outlet.ts";
import { identifierSchema } from "./shared.ts";

// Bounded opaque operation inputs, not business codes or Telegram identities.
const printable = (value: string) =>
  [...value].every(
    (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127
  );
export const planningIdSchema = identifierSchema.max(256).refine(printable);
const nameSchema = z.string().trim().min(1).max(256).refine(printable);
const timestampSchema = z.number().int().nonnegative().safe();
export const outletDetailSchema = outletSchema.extend({
  createdAt: timestampSchema,
  updatedAt: timestampSchema.nullable(),
});
export type OutletDetail = z.infer<typeof outletDetailSchema>;
export const createOutletSchema = z.object({ name: nameSchema }).strict();
export const updateOutletSchema = createOutletSchema.extend({
  id: planningIdSchema,
});
export const outletKeySchema = z.object({ id: planningIdSchema }).strict();
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
  id: identifierSchema,
  salesForceId: identifierSchema,
  outletId: identifierSchema,
  weekday: weekdaySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type VisitSchedule = z.infer<typeof visitScheduleSchema>;
export const scheduleDetailSchema = visitScheduleSchema.extend({
  outletName: z.string(),
  salesForceName: z.string(),
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
export const scheduleFilterSchema = ownScheduleFilterSchema.extend({
  salesForceId: planningIdSchema.optional(),
});
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
