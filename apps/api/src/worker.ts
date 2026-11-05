import type { BotActor, BotIdentityService } from "@sales-visit/contracts";
import { WorkerEntrypoint } from "cloudflare:workers";

import { IdentityOperations } from "./identity.ts";
import app from "./index.ts";

// Only Workers explicitly bound to this named entrypoint can invoke these methods.
// No fetch handler, HTTP router, header-based actor, or public RPC dispatcher.
export class BotIdentity
  extends WorkerEntrypoint<ApiBindings>
  implements BotIdentityService
{
  register(actor: BotActor) {
    return new IdentityOperations(this.env.DB).register(actor);
  }
  me(actor: BotActor) {
    return new IdentityOperations(this.env.DB).me(actor);
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
