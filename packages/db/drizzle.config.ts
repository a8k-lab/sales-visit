import { defineConfig } from "drizzle-kit";

// Generation is offline. Wrangler owns D1 migration application.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
