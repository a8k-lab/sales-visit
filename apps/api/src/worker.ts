import type { BotActor, BotIdentityService } from "@sales-visit/contracts";
import { WorkerEntrypoint } from "cloudflare:workers";

import { IdentityOperations } from "./identity.ts";
import app from "./index.ts";
import { OutletOperations } from "./outlets.ts";
import { ScheduleOperations } from "./schedules.ts";
import { VisitWizard } from "./visits/wizard.ts";

// Only Workers explicitly bound to this named entrypoint can invoke these methods.
// No fetch handler, HTTP router, header-based actor, or public RPC dispatcher.
export class BotIdentity
  extends WorkerEntrypoint<ApiBindings>
  implements BotIdentityService
{
  visitWizard(actor: BotActor, input: unknown) {
    return new VisitWizard(this.env.DB).handle(actor, input);
  }
  ownSchedule(actor: BotActor, input?: unknown) {
    return new ScheduleOperations(this.env.DB).own(actor, input);
  }
  listSchedules(actor: BotActor, input?: unknown) {
    return new ScheduleOperations(this.env.DB).list(actor, input);
  }
  createSchedule(actor: BotActor, input: unknown) {
    return new ScheduleOperations(this.env.DB).create(actor, input);
  }
  listOutlets(actor: BotActor, input?: unknown) {
    return new OutletOperations(this.env.DB).list(actor, input);
  }
  getOutlet(actor: BotActor, input: unknown) {
    return new OutletOperations(this.env.DB).get(actor, input);
  }
  createOutlet(actor: BotActor, input: unknown) {
    return new OutletOperations(this.env.DB).create(actor, input);
  }
  updateOutlet(actor: BotActor, input: unknown) {
    return new OutletOperations(this.env.DB).update(actor, input);
  }
  deleteOutlet(actor: BotActor, input: unknown) {
    return new OutletOperations(this.env.DB).delete(actor, input);
  }
  register(actor: BotActor) {
    return new IdentityOperations(this.env.DB).register(actor);
  }
  me(actor: BotActor) {
    return new IdentityOperations(this.env.DB).me(actor);
  }
  users(actor: BotActor, after?: string) {
    return new IdentityOperations(this.env.DB).users(actor, after);
  }
  setRole(actor: BotActor, input: unknown) {
    return new IdentityOperations(this.env.DB).setRole(actor, input);
  }
  disable(actor: BotActor, input: unknown) {
    return new IdentityOperations(this.env.DB).disable(actor, input);
  }
  enable(actor: BotActor, input: unknown) {
    return new IdentityOperations(this.env.DB).enable(actor, input);
  }
  pending(actor: BotActor, after?: string) {
    return new IdentityOperations(this.env.DB).pending(actor, after);
  }
  approve(actor: BotActor, input: unknown) {
    return new IdentityOperations(this.env.DB).approve(actor, input);
  }
  reject(actor: BotActor, input: unknown) {
    return new IdentityOperations(this.env.DB).reject(actor, input);
  }
}
export default app;
