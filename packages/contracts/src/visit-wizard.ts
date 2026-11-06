import { z } from "zod";

import type { BotActor } from "./identity.ts";
import { planningIdSchema } from "./planning.ts";
import { createVisitSchema } from "./write.ts";

export const visitWizardInputSchema = z.strictObject({
  messageId: z.number().int().positive().safe(),
  action: z.enum(["start", "cancel", "confirm", "answer"]),
  field: z.enum(["outlet", "time", "notes", "followUp"]).optional(),
  value: z.string().max(2000).optional(),
});
export type VisitWizardInput = z.infer<typeof visitWizardInputSchema>;
export const visitDraftPayloadSchema = createVisitSchema
  .omit({ stockReport: true })
  .extend({
    outletId: planningIdSchema,
    outletName: z.string(),
    notes: z.string().max(1000).optional(),
    followUp: z.string().max(1000).optional(),
  })
  .partial();
export type VisitDraftPayload = z.infer<typeof visitDraftPayloadSchema>;
export type VisitDraftStep =
  | "outlet"
  | "time"
  | "notes"
  | "followUp"
  | "review"
  | "submitting"
  | "submitted"
  | "cancelled"
  | "expired";
export interface VisitDraftView {
  step: VisitDraftStep;
  payload: VisitDraftPayload;
  expiresAt: number;
  visitId: string | null;
}
export type VisitWizardResult =
  | {
      ok: true;
      data: {
        draft: VisitDraftView | null;
        notice?:
          | "stale"
          | "invalid_input"
          | "outlet_missing"
          | "link_changed"
          | "busy";
      };
    }
  | { ok: false; code: "invalid" | "forbidden" | "unavailable" };
export interface BotVisitService {
  visitWizard(actor: BotActor, input: unknown): Promise<VisitWizardResult>;
}
