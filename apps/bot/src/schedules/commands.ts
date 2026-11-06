import {
  indonesianWeekdaySchema,
  indonesianWeekdays,
  telegramIdSchema,
  type BotIdentityService,
  type ScheduleDetail,
  type ScheduleFilter,
} from "@sales-visit/contracts";
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

export function jakartaWeekday(now = new Date()): number {
  return indonesianWeekdaySchema.parse(
    new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      timeZone: "Asia/Jakarta",
    }).format(now)
  );
}
function schedule(row: ScheduleDetail) {
  return [
    `Hari: ${indonesianWeekdays[row.weekday - 1]}\nNama Outlet: ${label(row.outletName)}\nID Outlet Bisnis: ${row.outletBusinessId === null ? "belum didata" : displayId(row.outletBusinessId)}\nNo. RS: ${row.outletNoRs === null ? "belum didata" : label(row.outletNoRs)}\nInternal ID/token (Visit): ${displayId(row.outletId)}`,
    `Sales Force: ${label(row.salesForceName)}\nSales Force ID bisnis: ${displayId(row.salesForceId)}\nTelegram ID: ${row.telegramUserId === null ? "asosiasi aktif unik belum terverifikasi" : label(row.telegramUserId)}`,
  ];
}
export function scheduleCommands(bot: Bot, api: BotIdentityService) {
  bot.command("jadwal", async (ctx) => {
    const input = await parseOrUsage(
      ctx,
      "Format: /jadwal [HARI|semua] [after=KURSOR]",
      () => {
        const tokens = args(ctx.match);
        const filter: ScheduleFilter = {};
        const day = tokens.shift();
        if (day === undefined) filter.weekday = jakartaWeekday();
        else if (day.toLowerCase() !== "semua")
          filter.weekday = indonesianWeekdaySchema.parse(day);
        if (tokens.length > 1 || (tokens[0] && !tokens[0].startsWith("after=")))
          throw new Error("args");
        if (tokens[0]) filter.after = decodeToken(tokens[0].slice(6));
        return filter;
      }
    );
    if (!input) return;
    // No identity selection is accepted here, including on follow-up pages.
    const page = await planningResult(ctx, () =>
      api.ownSchedule(actor(ctx), input)
    );
    if (!page) return;
    const day = input.weekday ? indonesianWeekdays[input.weekday - 1] : "semua";
    await replyBlocks(ctx, [
      `JADWAL SAYA — ${day}\nRencana berulang, bukan Visit selesai.`,
      ...page.items.flatMap(schedule),
      ...(!page.items.length ? ["Tidak ada jadwal."] : []),
      ...(page.next ? [nextPage(`/jadwal ${day} after=`, page.next)] : []),
    ]);
  });
  bot.command("jadwalsales", async (ctx) => {
    const input = await parseOrUsage(
      ctx,
      "Format: /jadwalsales [HARI | TELEGRAM_ID [HARI]] [after=KURSOR] atau /jadwalsales [hari=HARI] [sf=SALES_FORCE_ID] [after=KURSOR]",
      () => {
        const filter: ScheduleFilter = {};
        const seen = new Set<string>();
        const tokens = args(ctx.match);
        const positional = tokens.filter((token) => !token.includes("="));
        if (positional.length) {
          // Only a leading positional group; continuation after= may follow.
          if (
            tokens[0] !== positional[0] ||
            positional.length > 2 ||
            tokens.slice(0, positional.length).join(" ") !==
              positional.join(" ")
          )
            throw new Error("args");
          if (indonesianWeekdaySchema.safeParse(positional[0]).success) {
            if (positional.length !== 1) throw new Error("args");
            filter.weekday = indonesianWeekdaySchema.parse(positional[0]);
          } else {
            filter.telegramUserId = telegramIdSchema
              .max(256)
              .parse(positional[0]);
            if (positional[1])
              filter.weekday = indonesianWeekdaySchema.parse(positional[1]);
          }
        }
        for (const token of tokens.slice(positional.length)) {
          const split = token.indexOf("=");
          const key = token.slice(0, split);
          const value = token.slice(split + 1);
          if (
            split < 1 ||
            seen.has(key) ||
            (positional.length && key !== "after")
          )
            throw new Error("args");
          seen.add(key);
          if (key === "hari")
            filter.weekday = indonesianWeekdaySchema.parse(value);
          else if (key === "sf") filter.salesForceId = decodeToken(value);
          else if (key === "after") filter.after = decodeToken(value);
          else throw new Error("args");
        }
        return filter;
      }
    );
    if (!input) return;
    const page = await planningResult(ctx, () =>
      api.listSchedules(actor(ctx), input)
    );
    if (!page) return;
    const filters = (
      input.telegramUserId
        ? [
            input.telegramUserId,
            input.weekday ? indonesianWeekdays[input.weekday - 1] : "",
          ]
        : [
            input.weekday
              ? `hari=${indonesianWeekdays[input.weekday - 1]}`
              : "",
            input.salesForceId ? `sf=${displayId(input.salesForceId)}` : "",
          ]
    )
      .filter(Boolean)
      .join(" ");
    await replyBlocks(ctx, [
      `JADWAL SALES FORCE${filters ? ` — ${filters}` : ""}\nRencana berulang, bukan Visit selesai.`,
      ...page.items.flatMap(schedule),
      ...(!page.items.length ? ["Tidak ada jadwal."] : []),
      ...(page.next
        ? [
            nextPage(
              `/jadwalsales ${filters ? filters + " " : ""}after=`,
              page.next
            ),
          ]
        : []),
    ]);
  });
  bot.command("tambahjadwal", async (ctx) => {
    const input = await parseOrUsage(
      ctx,
      "Format: /tambahjadwal SALES_FORCE_ID OUTLET_ID HARI",
      () => {
        const tokens = args(ctx.match);
        if (tokens.length !== 3) throw new Error("args");
        return {
          salesForceId: decodeToken(tokens[0]!),
          outletId: decodeToken(tokens[1]!),
          weekday: indonesianWeekdaySchema.parse(tokens[2]),
        };
      }
    );
    if (!input) return;
    const row = await planningResult(ctx, () =>
      api.createSchedule(actor(ctx), input)
    );
    if (row)
      await replyBlocks(ctx, [
        `Jadwal berulang berhasil dibuat — ${indonesianWeekdays[row.weekday - 1]}.\nSales Force ID: ${displayId(row.salesForceId)}\nOutlet ID: ${displayId(row.outletId)}\nIni rencana, bukan Visit selesai.`,
      ]);
  });
}
