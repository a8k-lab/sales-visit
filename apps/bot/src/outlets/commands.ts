import type { BotIdentityService, OutletDetail } from "@sales-visit/contracts";
import type { Bot } from "grammy";

import { actor } from "../actor.ts";
import {
  args,
  decodeToken,
  displayId,
  label,
  nextPage,
  parseOrUsage,
  planningResult,
  replyBlocks,
} from "../planning/shared.ts";

function outlet(row: OutletDetail) {
  return `Nama Outlet: ${label(row.name)}\nID Outlet Bisnis: ${row.businessId === null ? "belum didata" : displayId(row.businessId)}\nNo. RS: ${row.noRs === null ? "belum didata" : label(row.noRs)}${row.businessId === null ? `\nInternal ID/token: ${displayId(row.id)}` : ""}`;
}
export function outletCommands(bot: Bot, api: BotIdentityService) {
  bot.command("outlets", async (ctx) => {
    const input = await parseOrUsage(ctx, "Format: /outlets [KURSOR]", () => {
      const tokens = args(ctx.match);
      if (tokens.length > 1) throw new Error("args");
      return tokens[0] ? { after: decodeToken(tokens[0]) } : {};
    });
    if (!input) return;
    const page = await planningResult(ctx, () =>
      api.listOutlets(actor(ctx), input)
    );
    if (!page) return;
    await replyBlocks(ctx, [
      "DAFTAR OUTLET",
      ...page.items.map(outlet),
      ...(!page.items.length ? ["Tidak ada Outlet."] : []),
      ...(page.next ? [nextPage("/outlets ", page.next)] : []),
    ]);
  });
  // Separate commands make legacy internal lookup explicit, even on namespace collisions.
  for (const internal of [false, true]) {
    const suffix = internal ? "internal" : "";
    const keyLabel = internal ? "INTERNAL_ID" : "BUSINESS_ID";
    const key = (token: string) =>
      internal
        ? { id: decodeToken(token) }
        : { businessId: decodeToken(token) };
    bot.command(`outlet${suffix}`, async (ctx) => {
      const input = await parseOrUsage(
        ctx,
        `Format: /outlet${suffix} ${keyLabel}`,
        () => {
          const tokens = args(ctx.match);
          if (tokens.length !== 1) throw new Error("args");
          return key(tokens[0]!);
        }
      );
      if (!input) return;
      const row = await planningResult(ctx, () =>
        api.getOutlet(actor(ctx), input)
      );
      if (row)
        await replyBlocks(ctx, [
          "DETAIL OUTLET",
          outlet(row),
          `Internal ID/token (Visit/Jadwal): ${displayId(row.id)}`,
        ]);
    });
    bot.command(`editoutlet${suffix}`, async (ctx) => {
      const input = await parseOrUsage(
        ctx,
        `Format: /editoutlet${suffix} ${keyLabel} NO_RS_BARU NAMA_OUTLET_BARU`,
        () => {
          const match = /^(\S+)\s+(\S+)\s+([\s\S]+)$/.exec(ctx.match.trim());
          if (!match) throw new Error("args");
          return {
            ...key(match[1]!),
            noRs: decodeToken(match[2]!),
            name: match[3]!,
          };
        }
      );
      if (!input) return;
      const row = await planningResult(ctx, () =>
        api.updateOutlet(actor(ctx), input)
      );
      if (row)
        await replyBlocks(ctx, ["Outlet berhasil diperbarui.", outlet(row)]);
    });
    bot.command(`hapusoutlet${suffix}`, async (ctx) => {
      const input = await parseOrUsage(
        ctx,
        `Format: /hapusoutlet${suffix} ${keyLabel} KONFIRMASI (ketik kata KONFIRMASI persis)`,
        () => {
          const tokens = args(ctx.match);
          if (tokens.length !== 2 || tokens[1] !== "KONFIRMASI")
            throw new Error("args");
          return key(tokens[0]!);
        }
      );
      if (!input) return;
      const row = await planningResult(ctx, () =>
        api.deleteOutlet(actor(ctx), input)
      );
      if (row)
        await replyBlocks(ctx, ["Outlet berhasil dihapus.", outlet(row)]);
    });
  }
  bot.command("tambahoutlet", async (ctx) => {
    const input = await parseOrUsage(
      ctx,
      "Format: /tambahoutlet BUSINESS_ID NO_RS NAMA_OUTLET",
      () => {
        const match = /^(\S+)\s+(\S+)\s+([\s\S]+)$/.exec(ctx.match.trim());
        if (!match) throw new Error("args");
        return {
          businessId: decodeToken(match[1]!),
          noRs: decodeToken(match[2]!),
          name: match[3]!,
        };
      }
    );
    if (!input) return;
    const row = await planningResult(ctx, () =>
      api.createOutlet(actor(ctx), input)
    );
    if (row) await replyBlocks(ctx, ["Outlet berhasil dibuat.", outlet(row)]);
  });
}
