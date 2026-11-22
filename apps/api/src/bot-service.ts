import type { BotActor, BotIdentityService } from "@sales-visit/contracts";

import { IdentityOperations } from "./identity.ts";
import { OutletOperations } from "./outlets.ts";
import { ScheduleOperations } from "./schedules.ts";
import { TelegramDemo } from "./telegram-demo.ts";
import { VisitWizard } from "./visits/wizard.ts";

type Env = { DB: D1Database; APP_ENV?: string; DEMO_AUTH_ENABLED?: string };
// Sole RPC actor routing point. No caller-supplied demo account, role or mode.
// All mutating commands (including registration and Visit drafts) fail closed in
// Demo Mode; only dedicated credential operations may write demo session tables.
export function botService(env: Env): BotIdentityService {
  const demo = new TelegramDemo(env);
  const identity = new IdentityOperations(env.DB);
  const outlets = new OutletOperations(env.DB);
  const schedules = new ScheduleOperations(env.DB);
  async function read<T>(
    actor: BotActor,
    real: () => Promise<T>,
    selected: () => Promise<T>
  ) {
    return (await demo.active(actor)) ? selected() : real();
  }
  async function write<T>(actor: BotActor, real: () => Promise<T>) {
    return (await demo.active(actor))
      ? ({ ok: false, code: "forbidden" } as const)
      : real();
  }
  return {
    demoAccounts: (actor) => demo.accounts(actor),
    demoSelect: (actor, token) => demo.select(actor, token),
    demoStatus: (actor) => demo.status(actor),
    demoLogout: (actor) => demo.logout(actor),
    me: (actor) =>
      read(
        actor,
        () => identity.me(actor),
        () => demo.me(actor)
      ),
    // Demo Admin may not enumerate or administer real users, even by known ID.
    users: (actor, after) => write(actor, () => identity.users(actor, after)),
    pending: (actor, after) =>
      write(actor, () => identity.pending(actor, after)),
    register: (actor) => write(actor, () => identity.register(actor)),
    approve: (actor, input) =>
      write(actor, () => identity.approve(actor, input)),
    reject: (actor, input) => write(actor, () => identity.reject(actor, input)),
    setRole: (actor, input) =>
      write(actor, () => identity.setRole(actor, input)),
    disable: (actor, input) =>
      write(actor, () => identity.disable(actor, input)),
    enable: (actor, input) => write(actor, () => identity.enable(actor, input)),
    listOutlets: (actor, input) =>
      read(
        actor,
        () => outlets.list(actor, input),
        () => new OutletOperations(env.DB, true).list(actor, input)
      ),
    getOutlet: (actor, input) =>
      read(
        actor,
        () => outlets.get(actor, input),
        () => new OutletOperations(env.DB, true).get(actor, input)
      ),
    createOutlet: (actor, input) =>
      write(actor, () => outlets.create(actor, input)),
    updateOutlet: (actor, input) =>
      write(actor, () => outlets.update(actor, input)),
    deleteOutlet: (actor, input) =>
      write(actor, () => outlets.delete(actor, input)),
    ownSchedule: (actor, input) =>
      read(
        actor,
        () => schedules.own(actor, input),
        () => new ScheduleOperations(env.DB, true).own(actor, input)
      ),
    listSchedules: (actor, input) =>
      read(
        actor,
        () => schedules.list(actor, input),
        () => new ScheduleOperations(env.DB, true).list(actor, input)
      ),
    createSchedule: (actor, input) =>
      write(actor, () => schedules.create(actor, input)),
    visitWizard: (actor, input) =>
      write(actor, () => new VisitWizard(env.DB).handle(actor, input)),
  };
}
