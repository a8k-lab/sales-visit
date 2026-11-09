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
// Deadlines travel in the identifier: lookup and mutation cannot disagree about
// the cutoff. The server issues these from its database clock, not browser time.
export const webOperationIdSchema = z
  .string()
  .regex(
    /^web:[0-9]{13}:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/
  );
export const webOperationDeadline = (operationId: string) =>
  Number(operationId.split(":")[1]);
export type WebOperationOutcome = {
  status: "pending" | "committed" | "not_committed";
};

// Web targets stored User IDs, never Telegram identity or a supplied actor.
export const webUserTargetSchema = z
  .object({
    userId: z.string().min(1).max(256),
    operationId: webOperationIdSchema,
  })
  .strict();
export const webUserRoleSchema = webUserTargetSchema
  .extend({
    role: z.enum(["admin", "supervisor", "sales_force"]),
    salesForceId: z.string().min(1).max(256).optional(),
  })
  .refine((input) =>
    input.role === "sales_force"
      ? !!input.salesForceId
      : input.salesForceId === undefined
  );
export interface ManagedAccount extends Account {
  salesForceName: string | null;
}
export interface UserPage {
  items: ManagedAccount[];
  next: string | null;
}

export const rejectionSchema = z
  .object({ telegramUserId: telegramIdSchema })
  .strict();
