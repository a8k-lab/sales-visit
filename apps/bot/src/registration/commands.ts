import {
  approvalSchema,
  rejectionSchema,
  roleChangeSchema,
  type Account,
  type BotIdentityService,
  type IdentityResult,
} from "@sales-visit/contracts";
import { Bot, type Context } from "grammy";

import { actor } from "../actor.ts";
import { label, replyBlocks } from "../planning/shared.ts";
import { helpSections } from "./help.ts";

const approvalUsage =
  "Format: /approve TELEGRAM_ID admin|supervisor\natau /approve TELEGRAM_ID sales SALES_FORCE_ID\nPastikan identitas Sales Force sudah diverifikasi sebelum menyetujui.";
const errors = {
  invalid: "Parameter tidak valid. Ketik /help untuk bantuan.",
  forbidden: "Akses ditolak. Khusus administrator aktif.",
  not_found: "Pengguna tidak ditemukan.",
  not_pending:
    "Pengguna bukan berstatus pending. Keputusan tidak diubah (termasuk akun disabled).",
  sales_force_unavailable:
    "Sales Force tidak ditemukan atau sudah terkait dengan akun lain. Hubungi administrator untuk verifikasi.",
  invalid_transition:
    "Perubahan tidak valid. /setrole hanya untuk akun active; /disable dari active; /enable dari disabled. Akun pending harus disetujui, akun rejected tidak dapat diaktifkan.",
  protected_admin:
    "Administrator aktif tidak dapat diturunkan role-nya atau dinonaktifkan melalui bot. Hubungi operator untuk prosedur pemulihan terpisah.",
  last_admin:
    "Admin aktif terakhir harus dipertahankan. Perubahan ditolak; gunakan prosedur pemulihan operator yang ditinjau terpisah.",
  association_locked:
    "Asosiasi Sales Force yang sudah ada tidak dapat diganti melalui perintah ini. Verifikasi dan koordinasikan perubahan dengan operator.",
};
function statusMessage(account: Account | null): string {
  if (!account) return "Kamu belum terdaftar. Gunakan /register.";
  switch (account.status) {
    case "active":
      return `Akun kamu sudah aktif dengan role ${account.role}.`;
    case "pending":
      return "Registrasi berhasil atau sedang menunggu persetujuan admin (pending).";
    case "rejected":
      return "Registrasi kamu ditolak (rejected). Hubungi administrator; registrasi ulang belum tersedia.";
    case "disabled":
      return "Akun kamu sedang dinonaktifkan (disabled). Hubungi administrator.";
  }
}
async function result<T>(
  ctx: Context,
  response: IdentityResult<T>
): Promise<T | undefined> {
  if (response.ok) return response.data;
  await ctx.reply(errors[response.code]);
  return undefined;
}
function profile(account: Account): string {
  return [
    "━━━━━━━━━━━━━━━━━━━━",
    "PROFIL PENGGUNA",
    "━━━━━━━━━━━━━━━━━━━━",
    `Telegram ID: ${account.telegramUserId}`,
    `Username: ${label(account.username ?? "-")}`,
    `Nama: ${label([account.firstName, account.lastName].filter(Boolean).join(" ")) || "-"}`,
    `Role: ${account.role ?? "-"}`,
    `Status: ${account.status}`,
    `Sales Force ID: ${label(account.salesForceId ?? "-")}`,
    `Terdaftar: ${new Date(account.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
  ].join("\n");
}
export function registerCommands(bot: Bot, api: BotIdentityService) {
  bot.command("register", async (ctx) => {
    const account = await result(ctx, await api.register(actor(ctx)));
    if (account) await ctx.reply(statusMessage(account));
  });
  bot.command("start", async (ctx) => {
    const response = await api.me(actor(ctx));
    if (!response.ok) {
      await result(ctx, response);
      return;
    }
    await ctx.reply(
      [
        "Halo! Selamat datang di Sales Visit Bot.",
        "",
        "Gunakan /register untuk mendaftarkan akun.",
        "Gunakan /me untuk melihat profil.",
        "Gunakan /help untuk melihat panduan.",
        "Gunakan /salesvisit untuk membuat laporan kunjungan (Sales Force aktif).",
        "",
        statusMessage(response.data),
        "Layanan hanya melalui chat pribadi.",
      ].join("\n")
    );
  });
  bot.command("help", async (ctx) => {
    const response = await api.me(actor(ctx));
    if (!response.ok) {
      await result(ctx, response);
      return;
    }
    await replyBlocks(ctx, helpSections(response.data));
  });
  bot.command("me", async (ctx) => {
    const response = await api.me(actor(ctx));
    if (!response.ok) {
      await result(ctx, response);
      return;
    }
    await ctx.reply(
      response.data ? profile(response.data) : statusMessage(null)
    );
  });
  bot.command("pending", async (ctx) => {
    const args = ctx.match.trim().split(/\s+/).filter(Boolean);
    if (args.length > 1) {
      await ctx.reply("Format: /pending [KURSOR]");
      return;
    }
    const page = await result(ctx, await api.pending(actor(ctx), args[0]));
    if (!page) return;
    if (!page.accounts.length) {
      await ctx.reply("Tidak ada permintaan registrasi.");
      return;
    }
    await replyBlocks(ctx, [
      "DAFTAR PERMINTAAN REGISTRASI",
      ...page.accounts.map(profile),
      ...(page.next ? [`Berikutnya: /pending ${page.next}`] : []),
    ]);
  });
  bot.command("users", async (ctx) => {
    const args = ctx.match.trim().split(/\s+/).filter(Boolean);
    if (args.length > 1) {
      await ctx.reply("Format: /users [KURSOR]");
      return;
    }
    const page = await result(ctx, await api.users(actor(ctx), args[0]));
    if (!page) return;
    await replyBlocks(ctx, [
      page.accounts.length
        ? "DAFTAR PENGGUNA"
        : "Belum ada pengguna terdaftar.",
      ...page.accounts.map((account) =>
        [
          `Nama: ${label([account.firstName, account.lastName].filter(Boolean).join(" ")) || "-"}`,
          `Telegram ID: ${account.telegramUserId}`,
          `Role: ${account.role ?? "-"}`,
          `Status: ${account.status}`,
          `Sales Force ID: ${label(account.salesForceId ?? "-")}`,
        ].join("\n")
      ),
      ...(page.next ? [`Berikutnya: /users ${page.next}`] : []),
    ]);
  });
  bot.command("setrole", async (ctx) => {
    const args = ctx.match.trim().split(/\s+/);
    const input = {
      telegramUserId: args[0],
      role: args[1],
      ...(args[2] ? { salesForceId: args[2] } : {}),
    };
    if (args.length > 3 || !roleChangeSchema.safeParse(input).success) {
      await ctx.reply(
        "Format: /setrole TELEGRAM_ID admin|supervisor\natau /setrole TELEGRAM_ID sales SALES_FORCE_ID\nRole sales_force juga diterima. Verifikasi ID bisnis SF; asosiasi yang sudah ada tidak dapat diganti."
      );
      return;
    }
    const account = await result(ctx, await api.setRole(actor(ctx), input));
    if (account)
      await ctx.reply(
        `Role pengguna ${account.telegramUserId}: ${account.role}. Asosiasi Sales Force: ${label(account.salesForceId ?? "-")}.`
      );
  });
  for (const command of ["disable", "enable"] as const) {
    bot.command(command, async (ctx) => {
      const args = ctx.match.trim().split(/\s+/);
      const input = { telegramUserId: args[0] };
      if (args.length !== 1 || !rejectionSchema.safeParse(input).success) {
        await ctx.reply(`Format: /${command} TELEGRAM_ID`);
        return;
      }
      const account = await result(ctx, await api[command](actor(ctx), input));
      if (account)
        await ctx.reply(
          `Akun ${account.telegramUserId} ${account.status === "disabled" ? "dinonaktifkan" : "aktif kembali"}. Role dan asosiasi Sales Force dipertahankan. Pengulangan tidak membuat audit tambahan.`
        );
    });
  }
  bot.command("approve", async (ctx) => {
    const args = ctx.match.trim().split(/\s+/);
    const input = {
      telegramUserId: args[0],
      role: args[1],
      ...(args[2] ? { salesForceId: args[2] } : {}),
    };
    if (args.length > 3 || !approvalSchema.safeParse(input).success) {
      await ctx.reply(approvalUsage);
      return;
    }
    const account = await result(ctx, await api.approve(actor(ctx), input));
    if (!account) return;
    await ctx.reply(
      `Pengguna ${account.telegramUserId} berhasil disetujui dengan role ${account.role}.`
    );
    await notify(
      ctx,
      account.telegramUserId,
      `Registrasi kamu telah disetujui!\nRole: ${account.role}\nKetik /me untuk profil.`
    );
  });
  bot.command("reject", async (ctx) => {
    const args = ctx.match.trim().split(/\s+/);
    const input = { telegramUserId: args[0] };
    if (args.length !== 1 || !rejectionSchema.safeParse(input).success) {
      await ctx.reply("Format: /reject TELEGRAM_ID");
      return;
    }
    const account = await result(ctx, await api.reject(actor(ctx), input));
    if (!account) return;
    await ctx.reply("Permintaan registrasi berhasil ditolak.");
    await notify(
      ctx,
      account.telegramUserId,
      "Maaf, permintaan registrasi kamu ditolak oleh administrator."
    );
  });
}
async function notify(ctx: Context, telegramUserId: string, text: string) {
  try {
    await ctx.api.sendMessage(telegramUserId, text);
  } catch {
    await ctx.reply(
      "Keputusan tersimpan, tetapi notifikasi pengguna gagal. Pengguna dapat memeriksa /me."
    );
  }
}
