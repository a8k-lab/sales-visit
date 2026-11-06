import type { BotActor } from "@sales-visit/contracts";
import type { Context } from "grammy";

export function actor(ctx: Context): BotActor {
  // Only called after verified-sender/private-chat middleware.
  return {
    telegramUserId: String(ctx.from!.id),
    username: ctx.from!.username,
    firstName: ctx.from!.first_name,
    lastName: ctx.from!.last_name,
  };
}
