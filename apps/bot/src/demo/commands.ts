import type { BotDemoResult, BotIdentityService } from "@sales-visit/contracts";
import type { Bot } from "grammy";

import { actor } from "../actor.ts";
import {
  args,
  decodeToken,
  displayId,
  label,
  replyBlocks,
} from "../planning/shared.ts";

const roles = [
  ["admin", "Admin"],
  ["supervisor", "Supervisor"],
  ["sales_force", "Sales Force"],
] as const;
const roleName = (role: string) =>
  roles.find(([key]) => key === role)?.[1] ?? role;
function status(result: BotDemoResult) {
  if (!result.ok) {
    if (result.code === "disabled") return "Demo Mode tidak tersedia.";
    if (result.code === "invalid")
      return "ID akun tidak valid. Format: /demo_login account_id. Salin ID/token dari /demo.";
    if (result.code === "expired")
      return "Akun demo tidak lagi tersedia. Gunakan /demo_login account_id untuk memilih lagi atau /demo_logout untuk keluar.";
    return "Akun demo tidak tersedia atau tidak memenuhi syarat. Ketik /demo untuk daftar akun.";
  }
  if (!result.data)
    return "Demo Mode tidak aktif. Autentikasi Telegram normal berlaku. Ketik /demo untuk daftar akun.";
  const { account, expiresAt } = result.data;
  return `Akun: ${label(account.name)}\nRole: ${roleName(account.role)}\nID: ${displayId(account.id)}\nSisa sesi: ${Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000))} menit.\nDemo Mode hanya baca. /demo_login account_id untuk ganti akun; /demo_logout untuk keluar.`;
}
export function demoCommands(bot: Bot, api: BotIdentityService) {
  bot.command("demo", async (ctx) => {
    try {
      const result = await api.demoAccounts(actor(ctx));
      if (!result.ok) {
        await ctx.reply("Demo Mode tidak tersedia.");
        return;
      }
      const blocks = [
        "AKUN DEMO\nPilih dengan /demo_login account_id\nSesi: 60 menit. Demo Mode hanya baca. Salin ID/token persis.",
      ];
      if (!result.items.length)
        blocks.push("Belum ada akun demo yang memenuhi syarat.");
      for (const [role, title] of roles) {
        let block = `${title}:`;
        for (const account of result.items.filter(
          (item) => item.role === role
        )) {
          const line = `\n${displayId(account.id)} — ${label(account.name)}`;
          if (block.length + line.length > 3500) {
            blocks.push(block);
            block = `${title} (lanjutan):`;
          }
          block += line;
        }
        if (block !== `${title}:`) blocks.push(block);
      }
      await replyBlocks(ctx, blocks);
    } catch {
      await ctx.reply("Daftar demo belum tersedia. Coba /demo lagi.");
    }
  });
  bot.command("demo_login", async (ctx) => {
    let accountId: string;
    try {
      const input = args(ctx.match);
      if (input.length !== 1) throw new Error("args");
      accountId = decodeToken(input[0]!);
    } catch {
      await ctx.reply(
        "Format: /demo_login account_id\nSalin satu ID/token dari /demo; tanpa role atau Telegram ID tambahan."
      );
      return;
    }
    let result: BotDemoResult;
    try {
      result = await api.demoLogin(actor(ctx), accountId);
    } catch {
      await ctx.reply(
        "Demo belum tersedia. Periksa /demo_status sebelum mencoba lagi."
      );
      return;
    }
    if (!result.ok || !result.data) {
      await ctx.reply(status(result));
      return;
    }
    await ctx.reply(
      `Demo Mode aktif.\n\nAkun: ${label(result.data.account.name)}\nRole: ${roleName(result.data.account.role)}\nSesi: 60 menit (hanya baca).\n\nGunakan /help untuk perintah yang tersedia.\n/demo_status untuk memeriksa sesi.\n/demo_logout untuk keluar.`
    );
  });
  bot.command("demo_status", async (ctx) => {
    await ctx.reply(status(await api.demoStatus(actor(ctx))));
  });
  bot.command("demo_logout", async (ctx) => {
    await ctx.reply(status(await api.demoLogout(actor(ctx))));
  });
}
