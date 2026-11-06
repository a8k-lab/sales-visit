import {
  approvalSchema,
  rejectionSchema,
  type Account,
  type BotIdentityService,
  type IdentityResult,
} from "@sales-visit/contracts";
import { Bot, type Context } from "grammy";

import { actor } from "../actor.ts";

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
    "PROFIL PENGGUNA",
    `Telegram ID: ${account.telegramUserId}`,
    `Username: ${account.username ?? "-"}`,
    `Nama: ${[account.firstName, account.lastName].filter(Boolean).join(" ") || "-"}`,
    `Role: ${account.role ?? "-"}`,
    `Status: ${account.status}`,
    `Sales Force ID: ${account.salesForceId ?? "-"}`,
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
      "Selamat datang di Sales Visit!\n\n" +
        statusMessage(response.data) +
        "\nKetik /help untuk bantuan."
    );
  });
  bot.command("help", async (ctx) => {
    const response = await api.me(actor(ctx));
    if (!response.ok) {
      await result(ctx, response);
      return;
    }
    const admin =
      response.data?.status === "active" && response.data.role === "admin";
    const role = response.data?.status === "active" ? response.data.role : null;
    const planning = [
      ...(role === "admin" || role === "supervisor"
        ? [
            "/outlets [KURSOR] — Daftar Outlet",
            "/outlet OUTLET_ID — Detail Outlet",
            "/jadwalsales [hari=HARI] [sf=SALES_FORCE_ID] [after=KURSOR] — Pantau rencana",
          ]
        : []),
      ...(admin
        ? [
            "/tambahoutlet NAMA_OUTLET",
            "/editoutlet OUTLET_ID NAMA_BARU",
            "/hapusoutlet OUTLET_ID KONFIRMASI — Hapus jika tidak dirujuk",
            "/tambahjadwal SALES_FORCE_ID OUTLET_ID HARI",
          ]
        : []),
      ...(role === "sales_force"
        ? [
            "/jadwal [HARI|semua] [after=KURSOR] — Rencana sendiri; tanpa HARI = hari ini WIB",
          ]
        : []),
      ...(role
        ? [
            "HARI: senin, selasa, rabu, kamis, jumat, sabtu, minggu.",
            "ID/kursor: salin token persis (termasuk awalan ~). ID sederhana boleh langsung; ID lain = ~ + base64url UTF-8 tanpa padding. Bukan kredensial.",
            "Sales Force ID adalah ID bisnis, bukan Telegram ID. Nama Outlet boleh mengandung spasi dan tidak unik. Salin perintah Berikutnya agar filter tetap sama.",
            "Jadwal adalah rencana berulang, bukan Visit selesai. Jangan ulangi pembuatan setelah kegagalan sebelum memeriksa daftar.",
          ]
        : []),
    ].join("\n");
    await ctx.reply(
      "/start — Perkenalan\n/help — Bantuan\n/register — Registrasi\n/me — Profil dan status\n\n" +
        (admin
          ? "/pending [KURSOR] — Permintaan registrasi\n" +
            approvalUsage +
            "\n/reject TELEGRAM_ID — Tolak registrasi\n\n"
          : "Persetujuan akun hanya oleh administrator.\n\n") +
        (planning ? planning + "\n\n" : "") +
        "Pelaporan Visit dan Stock Report belum tersedia. Jangan kirim data laporan melalui chat ini dulu."
    );
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
    await ctx.reply("DAFTAR PERMINTAAN REGISTRASI");
    // One bounded profile per message avoids Telegram's 4096-character limit.
    for (const account of page.accounts) await ctx.reply(profile(account));
    if (page.next) await ctx.reply(`Berikutnya: /pending ${page.next}`);
  });
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
