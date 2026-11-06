import assert from "node:assert/strict";
import { test } from "node:test";

import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("ambiguous create RPC transport failure is acknowledged without retry or raw error leakage", async (t) => {
  const bundle = await build({
    entryPoints: [new URL("../../bot/src/index.ts", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers"],
  });
  const messages = [];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "fault-api",
          modules: true,
          compatibilityDate: "2026-11-02",
          // Test-only named binding fault injector, never deployed or configured by env.
          script: `import { WorkerEntrypoint } from 'cloudflare:workers';
        let calls = 0;
        export class BotIdentity extends WorkerEntrypoint {
          async createOutlet() { calls++; throw new Error('sensitive database failure'); }
        }
        export default { fetch() { return Response.json({ calls }); } };`,
        },
        {
          name: "bot",
          modules: true,
          compatibilityDate: "2026-11-02",
          script: bundle.outputFiles[0].text,
          bindings: {
            TELEGRAM_BOT_TOKEN: "123:synthetic",
            TELEGRAM_WEBHOOK_SECRET: "synthetic",
          },
          serviceBindings: {
            IDENTITY: { name: "fault-api", entrypoint: "BotIdentity" },
          },
          outboundService: async (req) => {
            if (req.url.endsWith("/getMe"))
              return Response.json({
                ok: true,
                result: {
                  id: 123,
                  is_bot: true,
                  first_name: "Test",
                  username: "test_bot",
                },
              });
            const body = await req.json();
            messages.push(body.text);
            return Response.json({
              ok: true,
              result: {
                message_id: 1,
                date: 1,
                chat: { id: 1, type: "private" },
                text: body.text,
              },
            });
          },
        },
      ],
    })
  );
  t.after(() => mf.dispose());
  const bot = await mf.getWorker("bot");
  const response = await bot.fetch("https://bot/", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "synthetic" },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 1, type: "private" },
        from: { id: 1, first_name: "Synthetic", is_bot: false },
        text: "/tambahoutlet 001 002 Synthetic",
        entities: [{ type: "bot_command", offset: 0, length: 13 }],
      },
    }),
  });
  assert.equal(response.status, 200);
  assert.match(messages.join(""), /Koneksi ke API gagal/);
  assert.doesNotMatch(messages.join(""), /sensitive|database/);
  const api = await mf.getWorker("fault-api");
  assert.deepEqual(await (await api.fetch("https://test/")).json(), {
    calls: 1,
  });
});
