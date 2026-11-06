import type { BotIdentityService, OutletDetail } from "@sales-visit/contracts";
import type { Bot } from "grammy";

import { actor } from "../actor.ts";
import {
  args,
  decodeToken,
  displayId,
  label,
  parseOrUsage,
  planningResult,
  replyBlocks,
} from "../planning/shared.ts";

function outlet(row: OutletDetail) {
  return `${label(row.name)}\nOutlet ID: ${displayId(row.id)}`;
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
      ...(page.next ? [`Berikutnya: /outlets ${displayId(page.next)}`] : []),
    ]);
  });
  bot.command("outlet", async (ctx) => {
    const input = await parseOrUsage(ctx, "Format: /outlet OUTLET_ID", () => {
      const tokens = args(ctx.match);
      if (tokens.length !== 1) throw new Error("args");
      return { id: decodeToken(tokens[0]!) };
    });
    if (!input) return;
    const row = await planningResult(ctx, () =>
      api.getOutlet(actor(ctx), input)
    );
    if (row)
      await replyBlocks(ctx, [
        outlet(row),
        `Dibuat (epoch ms): ${row.createdAt}\nDiperbarui (epoch ms): ${row.updatedAt ?? "belum diketahui"}`,
      ]);
  });
  bot.command("tambahoutlet", async (ctx) => {
    const name = ctx.match.trim();
    if (!name) {
      await ctx.reply("Format: /tambahoutlet NAMA_OUTLET");
      return;
    }
    const row = await planningResult(ctx, () =>
      api.createOutlet(actor(ctx), { name })
    );
    if (row) await replyBlocks(ctx, ["Outlet berhasil dibuat.", outlet(row)]);
  });
  bot.command("editoutlet", async (ctx) => {
    const input = await parseOrUsage(
      ctx,
      "Format: /editoutlet OUTLET_ID NAMA_BARU",
      () => {
        const match = /^(\S+)\s+([\s\S]+)$/.exec(ctx.match.trim());
        if (!match) throw new Error("args");
        return { id: decodeToken(match[1]!), name: match[2]! };
      }
    );
    if (!input) return;
    const row = await planningResult(ctx, () =>
      api.updateOutlet(actor(ctx), input)
    );
    if (row)
      await replyBlocks(ctx, ["Nama Outlet berhasil diperbarui.", outlet(row)]);
  });
  bot.command("hapusoutlet", async (ctx) => {
    const input = await parseOrUsage(
      ctx,
      "Format: /hapusoutlet OUTLET_ID KONFIRMASI (ketik kata KONFIRMASI persis)",
      () => {
        const tokens = args(ctx.match);
        if (tokens.length !== 2 || tokens[1] !== "KONFIRMASI")
          throw new Error("args");
        return { id: decodeToken(tokens[0]!) };
      }
    );
    if (!input) return;
    const row = await planningResult(ctx, () =>
      api.deleteOutlet(actor(ctx), input)
    );
    if (row) await replyBlocks(ctx, ["Outlet berhasil dihapus.", outlet(row)]);
  });
}
