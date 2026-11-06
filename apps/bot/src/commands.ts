import type { BotIdentityService } from "@sales-visit/contracts";
import { type Bot } from "grammy";

import { outletCommands } from "./outlets/commands.ts";
import { registerCommands } from "./registration/commands.ts";
import { scheduleCommands } from "./schedules/commands.ts";

export function installCommands(bot: Bot, api: BotIdentityService) {
  bot.use(async (ctx, next) => {
    if (
      !ctx.message ||
      !ctx.from ||
      ctx.from.is_bot ||
      !Number.isSafeInteger(ctx.from.id) ||
      ctx.from.id <= 0
    )
      return;
    if (ctx.chat?.type !== "private") {
      await ctx.reply(
        "Gunakan chat pribadi dengan bot untuk registrasi dan administrasi."
      );
      return;
    }
    await next();
  });
  registerCommands(bot, api);
  // Planning deliveries are acknowledged even if a reply fails: Telegram must
  // not redeliver a non-idempotent create after an ambiguous API/delivery error.
  bot.use(async (_ctx, next) => {
    try {
      await next();
    } catch {
      console.error("Planning command delivery failed");
    }
  });
  outletCommands(bot, api);
  scheduleCommands(bot, api);
  bot.on("message:text", (ctx) =>
    ctx.reply(
      "Ketik /help untuk melihat perintah yang tersedia. Pelaporan belum tersedia."
    )
  );
}
