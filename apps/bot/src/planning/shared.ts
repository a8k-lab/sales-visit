import { planningIdSchema, type PlanningResult } from "@sales-visit/contracts";
import type { Context } from "grammy";

// Reserved ~ prefix; canonical unpadded base64url of UTF-8, never normalization.
export function encodeToken(value: string): string {
  if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
  return (
    "~" +
    btoa(String.fromCharCode(...new TextEncoder().encode(value)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "")
  );
}
export function decodeToken(token: string): string {
  let value = token;
  if (token.startsWith("~")) {
    if (!/^~[A-Za-z0-9_-]+$/.test(token) || token.length > 1400)
      throw new Error("token");
    const base = token.slice(1).replaceAll("-", "+").replaceAll("_", "/");
    value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Uint8Array.from(atob(base), (char) => char.charCodeAt(0))
    );
    // Also rejects noncanonical base64 padding bits and encoded simple IDs.
    if (encodeToken(value) !== token) throw new Error("token");
  } else if (!/^[A-Za-z0-9_.-]+$/.test(token)) throw new Error("token");
  return planningIdSchema.parse(value);
}
export const args = (text: string) => text.trim().split(/\s+/).filter(Boolean);
export function displayId(value: string): string {
  return planningIdSchema.safeParse(value).success
    ? encodeToken(value)
    : "[ID di luar batas operasi; hubungi administrator]";
}
export function label(value: string): string {
  // Plain text, bounded display only. Do not change keys used by RPC.
  const safe = value.replace(/[\p{Cc}\p{Cf}]/gu, " ");
  return [...safe].slice(0, 160).join("") + ([...safe].length > 160 ? "…" : "");
}
export async function replyBlocks(ctx: Context, blocks: string[]) {
  let text = "";
  for (const block of blocks) {
    if (block.length > 4096) throw new Error("Oversized message block");
    if (text.length + block.length + 2 > 4096) {
      await ctx.reply(text);
      text = "";
    }
    text += (text ? "\n\n" : "") + block;
  }
  if (text) await ctx.reply(text);
}
const errors = {
  invalid: "Parameter tidak valid. Ketik /help untuk format perintah.",
  forbidden: "Akses ditolak. Periksa role dan status aktif melalui /me.",
  not_found: "Outlet tidak ditemukan.",
  referenced:
    "Outlet masih dirujuk Jadwal, Visit, atau Stock Report; tidak dapat dihapus.",
  duplicate: "Penugasan yang sama sudah ada pada hari tersebut.",
  reference_not_found:
    "Sales Force atau Outlet tidak ditemukan. Periksa ID bisnis yang dipilih.",
  unavailable:
    "Layanan data belum tersedia. Periksa daftar sebelum mengulangi perubahan.",
};
export async function planningResult<T>(
  ctx: Context,
  call: () => Promise<PlanningResult<T>>
) {
  let response: PlanningResult<T>;
  try {
    response = await call();
  } catch {
    await ctx.reply(
      "Koneksi ke API gagal; hasil operasi belum dapat dipastikan. Periksa daftar sebelum mengulangi perubahan. Bot tidak mencoba ulang otomatis."
    );
    return undefined;
  }
  if (response.ok) return response.data;
  await ctx.reply(errors[response.code]);
  return undefined;
}

export async function parseOrUsage<T>(
  ctx: Context,
  usage: string,
  parse: () => T
): Promise<T | undefined> {
  try {
    return parse();
  } catch {
    await ctx.reply(
      usage +
        "\nID/kursor: salin token persis dari balasan bot. Ketik /help untuk bantuan."
    );
    return undefined;
  }
}
