import { Bot, webhookCallback } from "grammy";

import { installCommands } from "./commands.ts";
import { readUpdate } from "./webhook.ts";

export default {
  async fetch(request: Request, env: CloudflareBindings): Promise<Response> {
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return new Response("Invalid request URL", { status: 400 });
    }

    if (pathname === "/health" && request.method === "GET") {
      return Response.json({ status: "ok", service: "sales-visit-bot" });
    }

    if (pathname !== "/") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "POST" },
      });
    }

    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Bot is not configured", { status: 503 });
    }

    // Register the webhook with secret_token matching this Worker secret.
    // Reject unauthenticated requests before grammY calls Telegram's getMe API.
    if (
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
      env.TELEGRAM_WEBHOOK_SECRET
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const update = await readUpdate(request);
      if (update instanceof Response) return update;
      const verifiedRequest = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: update,
      });
      const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
      installCommands(bot, env.IDENTITY);
      return await webhookCallback(bot, "cloudflare-mod", {
        secretToken: env.TELEGRAM_WEBHOOK_SECRET,
        onTimeout: "throw",
      })(verifiedRequest);
    } catch {
      // Do not log raw errors: Telegram URLs may contain the bot token.
      console.error("Telegram webhook processing failed");
      // A non-2xx response lets Telegram retry failed deliveries.
      return new Response("Webhook processing failed", { status: 500 });
    }
  },
};
