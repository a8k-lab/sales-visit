import { spawnSync } from "node:child_process";

const apiUrl =
  process.env.VITE_API_URL ??
  "https://sales-visit-api-dev.rtrivaldo05.workers.dev";

const result = spawnSync("pnpm", ["--filter", "@sales-visit/web", "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_API_URL: apiUrl,
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
