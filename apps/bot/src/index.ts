import { Bot, webhookCallback } from "grammy";

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

    // Keep this entrypoint stateless. Reporting will use the shared API once
    // Telegram identity linking and server-side permissions are implemented.
    bot.command("start", (ctx) =>
      ctx.reply(
        "Selamat datang di Sales Visit!\n\n" +
          "Bot ini akan membantu Sales Force mencatat Visit dan Stock Report untuk Outlet.\n" +
          "Fitur pelaporan belum tersedia. Tidak ada laporan yang disimpan.\n\n" +
          "Ketik /help untuk bantuan."
      )
    );

    bot.command("help", (ctx) =>
      ctx.reply(
        "/start — Perkenalan Sales Visit\n" +
          "/help — Bantuan\n\n" +
          "Pelaporan Visit dan Stock Report belum tersedia. " +
          "Jangan kirim data laporan melalui chat ini dulu."
      )
    );

    bot.on("message:text", (ctx) =>
      ctx.reply(
        "Pelaporan belum tersedia. Ketik /help untuk melihat perintah yang tersedia."
      )
    );

    try {
      return await webhookCallback(bot, "cloudflare-mod", {
        secretToken: env.TELEGRAM_WEBHOOK_SECRET,
        onTimeout: "throw",
      })(request);
    } catch {
      // Do not log raw errors: Telegram URLs may contain the bot token.
      console.error("Telegram webhook processing failed");
      // A non-2xx response lets Telegram retry failed deliveries.
      return new Response("Webhook processing failed", { status: 500 });
    }
  },
};
