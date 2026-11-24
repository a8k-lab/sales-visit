import type { BotActor, BotIdentityService } from "@sales-visit/contracts";
import { WorkerEntrypoint } from "cloudflare:workers";

import { botService } from "./bot-service.ts";
import app from "./index.ts";

// Only the privately bound bot Worker can supply a verified Telegram sender.
export class BotIdentity
  extends WorkerEntrypoint<ApiBindings>
  implements BotIdentityService
{
  private service() {
    return botService(this.env);
  }
  demoAccounts(actor: BotActor) {
    return this.service().demoAccounts(actor);
  }
  demoLogin(actor: BotActor, accountId: unknown) {
    return this.service().demoLogin(actor, accountId);
  }
  demoStatus(actor: BotActor) {
    return this.service().demoStatus(actor);
  }
  demoLogout(actor: BotActor) {
    return this.service().demoLogout(actor);
  }
  visitWizard(actor: BotActor, input: unknown) {
    return this.service().visitWizard(actor, input);
  }
  ownSchedule(actor: BotActor, input?: unknown) {
    return this.service().ownSchedule(actor, input);
  }
  listSchedules(actor: BotActor, input?: unknown) {
    return this.service().listSchedules(actor, input);
  }
  createSchedule(actor: BotActor, input: unknown) {
    return this.service().createSchedule(actor, input);
  }
  listOutlets(actor: BotActor, input?: unknown) {
    return this.service().listOutlets(actor, input);
  }
  getOutlet(actor: BotActor, input: unknown) {
    return this.service().getOutlet(actor, input);
  }
  createOutlet(actor: BotActor, input: unknown) {
    return this.service().createOutlet(actor, input);
  }
  updateOutlet(actor: BotActor, input: unknown) {
    return this.service().updateOutlet(actor, input);
  }
  deleteOutlet(actor: BotActor, input: unknown) {
    return this.service().deleteOutlet(actor, input);
  }
  register(actor: BotActor) {
    return this.service().register(actor);
  }
  me(actor: BotActor) {
    return this.service().me(actor);
  }
  users(actor: BotActor, after?: string) {
    return this.service().users(actor, after);
  }
  setRole(actor: BotActor, input: unknown) {
    return this.service().setRole(actor, input);
  }
  disable(actor: BotActor, input: unknown) {
    return this.service().disable(actor, input);
  }
  enable(actor: BotActor, input: unknown) {
    return this.service().enable(actor, input);
  }
  pending(actor: BotActor, after?: string) {
    return this.service().pending(actor, after);
  }
  approve(actor: BotActor, input: unknown) {
    return this.service().approve(actor, input);
  }
  reject(actor: BotActor, input: unknown) {
    return this.service().reject(actor, input);
  }
}
export default app;
