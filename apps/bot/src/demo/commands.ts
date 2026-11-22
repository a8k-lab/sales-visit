import type { BotDemoResult, BotIdentityService } from "@sales-visit/contracts";
import { InlineKeyboard, type Bot } from "grammy";

import { actor } from "../actor.ts";

const roles = [
  ["admin", "Admin"],
  ["supervisor", "Supervisor"],
  ["sales_force", "Sales Force"],
] as const;
function status(result: BotDemoResult) {
  if (!result.ok)
    return result.code === "disabled"
      ? "Demo Mode tidak tersedia. Hanya aktif di local/staging dengan DEMO_AUTH_ENABLED=true."
      : "Pilihan demo tidak valid atau kedaluwarsa. Ketik /demo untuk memilih lagi.";
  if (!result.data)
    return "Demo Mode tidak aktif. Autentikasi Telegram normal berlaku. Ketik /demo untuk memilih akun.";
  const { account, expiresAt } = result.data;
  return `Demo Mode: ${account.name}\nRole: ${account.role}\nUser ID: ${account.id}\nSisa sesi: ${Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000))} menit.\nHanya baca data demo; perubahan data, registrasi, dan input Visit dinonaktifkan. /demo untuk ganti akun; /demo_logout untuk keluar.`;
}
export function demoCommands(bot: Bot, api: BotIdentityService) {
  // Acknowledge every matching callback, including malformed/expired choices.
  bot.callbackQuery(/^demo:/, async (ctx) => {
    try {
      const result = await api.demoSelect(
        actor(ctx),
        ctx.callbackQuery.data.slice(5)
      );
      await ctx.answerCallbackQuery({
        text: result.ok
          ? "Demo Mode aktif"
          : "Pilihan tidak tersedia; gunakan /demo.",
      });
      if (result.ok)
        await ctx.editMessageReplyMarkup({
          reply_markup: new InlineKeyboard(),
        });
      await ctx.reply(status(result));
    } catch {
      await ctx.answerCallbackQuery({
        text: "Demo tidak tersedia. Coba /demo lagi.",
      });
    }
  });
  bot.command("demo", async (ctx) => {
    const result = await api.demoAccounts(actor(ctx));
    if (!result.ok) {
      await ctx.reply("Demo Mode tidak tersedia.");
      return;
    }
    await ctx.reply(
      "Pilih akun Demo Mode (1 jam). Hanya baca data demo; tidak mengubah akun Telegram asli. Pilihan berlaku 5 menit."
    );
    if (!result.items.length)
      await ctx.reply("Belum ada akun demo yang memenuhi syarat.");
    for (const [role, label] of roles) {
      const items = result.items.filter((item) => item.role === role);
      for (let i = 0; i < items.length; i += 40) {
        const keyboard = new InlineKeyboard();
        for (const item of items.slice(i, i + 40))
          keyboard.text(item.name, `demo:${item.token}`).row();
        await ctx.reply(label, { reply_markup: keyboard });
      }
    }
  });
  bot.command("demo_status", async (ctx) => {
    await ctx.reply(status(await api.demoStatus(actor(ctx))));
  });
  bot.command("demo_logout", async (ctx) => {
    await ctx.reply(status(await api.demoLogout(actor(ctx))));
  });
}
