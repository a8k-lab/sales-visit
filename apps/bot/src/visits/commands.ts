import type {
  BotIdentityService,
  VisitWizardInput,
  VisitWizardResult,
} from "@sales-visit/contracts";
import type { Bot, Context } from "grammy";

import { actor as actorFromContext } from "../actor.ts";
import {
  decodeToken,
  displayId,
  label,
  replyBlocks,
} from "../planning/shared.ts";

const prompts = {
  outlet:
    "1/5 • Pilih Outlet\nKetik: outlet TOKEN_OUTLET\nSalin token dari /jadwal semua, atau gunakan token Outlet yang diketahui untuk kunjungan di luar jadwal. Penugasan tidak diwajibkan.",
  time: "2/5 • Waktu kunjungan sebenarnya (WIB / Asia/Jakarta)\nKetik: waktu sekarang\nAtau: waktu DD-MM-YYYY HH:mm\nHanya waktu yang sudah terjadi, maksimal 366 hari lalu; waktu mendatang ditolak.",
  notes:
    "3/5 • Catatan kunjungan (maks. 1000 karakter)\nKetik: catatan Isi catatan\nTanpa catatan: catatan lewati",
  followUp:
    "4/5 • Tindak lanjut (maks. 1000 karakter)\nKetik: tindaklanjut Isi tindak lanjut\nTanpa tindak lanjut: tindaklanjut lewati",
};
const notices = {
  stale:
    "Pesan lama/bersamaan tidak diterapkan. Berikut keadaan terbaru; kirim ulang jawaban bila perlu.",
  invalid_input:
    "Jawaban belum sesuai langkah/format. Draf tidak berubah; ikuti petunjuk berikut.",
  outlet_missing:
    "Outlet tidak ditemukan atau sudah dihapus. Periksa token. Jika sudah mengonfirmasi, gunakan /batal lalu /salesvisit untuk mengganti Outlet.",
  link_changed:
    "Tautan Sales Force berubah. Draf lama tidak dapat dikirim atas nama Sales Force baru. Gunakan /batal lalu /salesvisit, atau hubungi Admin.",
  busy: "Konfirmasi sedang diproses. Ketik /konfirmasi untuk memeriksa hasil; jangan mulai kunjungan pengganti.",
};

async function render(ctx: Context, result: VisitWizardResult) {
  if (!result.ok) {
    if (result.code === "unavailable")
      throw new Error("Visit service unavailable");
    await ctx.reply(
      result.code === "forbidden"
        ? "Akses ditolak. Hanya akun Sales Force aktif dengan tautan Sales Force sah yang dapat melaporkan. Periksa /me atau /register."
        : "Parameter tidak valid. Ketik /salesvisit atau /help."
    );
    return;
  }
  const { draft, notice } = result.data;
  const blocks = notice ? [notices[notice]] : [];
  if (!draft)
    blocks.push(
      "Tidak ada draf Visit. Mulai dengan /salesvisit. Bantuan: /help."
    );
  else if (draft.step === "submitted")
    blocks.push(
      `Visit berhasil tersimpan.\nNomor: ${draft.visitId}\n/konfirmasi mengulang hasil ini tanpa membuat Visit baru.\nKunjungan lain: /salesvisit.`
    );
  else if (draft.step === "cancelled")
    blocks.push(
      "Draf dibatalkan. Tidak ada Visit baru dibuat. Mulai lagi: /salesvisit."
    );
  else if (draft.step === "expired")
    blocks.push(
      "Draf kedaluwarsa setelah 24 jam sejak dimulai. Tidak ada Visit dibuat. Mulai lagi: /salesvisit."
    );
  else if (draft.step === "submitting")
    blocks.push(
      "Draf dibekukan untuk pengiriman. Ketik /konfirmasi untuk mencoba ulang dengan aman. /batal hanya membatalkan jika Visit belum tersimpan."
    );
  else if (draft.step === "review") {
    const p = draft.payload;
    blocks.push(
      `5/5 • Tinjau Visit\nOutlet: ${label(p.outletName ?? "")}\nToken: ${displayId(p.outletId ?? "")}`
    );
    blocks.push(
      `Waktu sebenarnya (WIB): ${new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(p.visitedAt!))}`
    );
    // Keep complete user-entered notes, not truncated labels. Plain text only.
    blocks.push(
      `Catatan: ${p.notes ?? "(dilewati)"}\nTindak lanjut: ${p.followUp ?? "(dilewati)"}`
    );
    blocks.push(
      "Kirim: /konfirmasi\nBuang draf: /batal\nIni Visit minimal, tanpa laporan stok/keuangan."
    );
  } else
    blocks.push(
      prompts[draft.step] +
        "\n/batal kapan saja. /salesvisit melanjutkan draf, bukan menimpanya. Draf berlaku 24 jam sejak dimulai."
    );
  await replyBlocks(ctx, blocks);
}

export function visitCommands(bot: Bot, api: BotIdentityService) {
  const call = async (
    ctx: Context,
    input: Omit<VisitWizardInput, "messageId">
  ) => {
    const actor = actorFromContext(ctx);
    if (!actor || !ctx.message) return;
    // No catch-and-ack middleware here. Durable/idempotent transitions make
    // webhook retries safe after API transport or Telegram reply failures.
    await render(
      ctx,
      await api.visitWizard(actor, {
        ...input,
        messageId: ctx.message.message_id,
      })
    );
  };
  bot.command("salesvisit", (ctx) => call(ctx, { action: "start" }));
  bot.command("konfirmasi", (ctx) => call(ctx, { action: "confirm" }));
  bot.command("batal", (ctx) => call(ctx, { action: "cancel" }));
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return next();
    const match = /^(outlet|waktu|catatan|tindaklanjut)\s+([\s\S]+)$/i.exec(
      text
    );
    if (!match) return next();
    const fields = {
      outlet: "outlet",
      waktu: "time",
      catatan: "notes",
      tindaklanjut: "followUp",
    } as const;
    const field = fields[match[1]!.toLowerCase() as keyof typeof fields];
    let value = match[2]!;
    if (field === "outlet") {
      try {
        value = decodeToken(value);
      } catch {
        await ctx.reply(
          "Token Outlet tidak valid. Salin token persis dari /jadwal semua, lalu ketik: outlet TOKEN_OUTLET"
        );
        return;
      }
    }
    await call(ctx, { action: "answer", field, value });
  });
}
