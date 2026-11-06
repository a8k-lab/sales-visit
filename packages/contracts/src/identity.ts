import { z } from "zod";

import type { BotPlanningService } from "./planning.ts";
import type { BotVisitService } from "./visit-wizard.ts";

export const telegramIdSchema = z.string().regex(/^[1-9][0-9]*$/);
export const botActorSchema = z
  .object({
    telegramUserId: telegramIdSchema,
    username: z.string().max(128).nullable().optional(),
    firstName: z.string().max(256).nullable().optional(),
    lastName: z.string().max(256).nullable().optional(),
  })
  .strict();
export type BotActor = z.infer<typeof botActorSchema>;
export interface Account {
  id: string;
  telegramUserId: string;
  status: "pending" | "active" | "rejected" | "disabled";
  role: "admin" | "supervisor" | "sales_force" | null;
  salesForceId: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: number;
}
export type IdentityResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code:
        | "invalid"
        | "forbidden"
        | "not_found"
        | "not_pending"
        | "sales_force_unavailable"
        | "invalid_transition"
        | "protected_admin"
        | "last_admin"
        | "association_locked";
    };
export interface BotIdentityService
  extends BotPlanningService, BotVisitService {
  register(actor: BotActor): Promise<IdentityResult<Account>>;
  me(actor: BotActor): Promise<IdentityResult<Account | null>>;
  pending(
    actor: BotActor,
    after?: string
  ): Promise<IdentityResult<{ accounts: Account[]; next: string | null }>>;
  users(
    actor: BotActor,
    after?: string
  ): Promise<IdentityResult<{ accounts: Account[]; next: string | null }>>;
  setRole(actor: BotActor, input: unknown): Promise<IdentityResult<Account>>;
  disable(actor: BotActor, input: unknown): Promise<IdentityResult<Account>>;
  enable(actor: BotActor, input: unknown): Promise<IdentityResult<Account>>;
  approve(actor: BotActor, input: unknown): Promise<IdentityResult<Account>>;
  reject(actor: BotActor, input: unknown): Promise<IdentityResult<Account>>;
}
export const approvalSchema = z
  .object({
    telegramUserId: telegramIdSchema,
    role: z
      .enum(["admin", "supervisor", "sales", "sales_force"])
      .transform((role) =>
        role === "sales" ? ("sales_force" as const) : role
      ),
    salesForceId: z.string().trim().min(1).max(256).optional(),
  })
  .strict()
  .refine((input) =>
    input.role === "sales_force"
      ? !!input.salesForceId
      : input.salesForceId === undefined
  );
// Same explicit association rule as approval, including the legacy sales alias.
export const roleChangeSchema = approvalSchema;
export const rejectionSchema = z
  .object({ telegramUserId: telegramIdSchema })
  .strict();
