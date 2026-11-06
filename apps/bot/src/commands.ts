import type { BotIdentityService } from "@sales-visit/contracts";
import { type Bot } from "grammy";

import { registerCommands } from "./registration/commands.ts";

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
  bot.on("message:text", (ctx) =>
    ctx.reply(
      "Ketik /help untuk melihat perintah yang tersedia. Pelaporan belum tersedia."
    )
  );
}
