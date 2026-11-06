import { changedPaths, git, impact } from "./changes.mjs";
import { names } from "./targets.mjs";

// Liveness is not RPC compatibility. Require identical API/shared artifact inputs
// to the checkout validated by local integration tests, not a public RPC probe.
export function assertApiCompatibility(
  api,
  revision,
  {
    diff = changedPaths,
    ancestor = (base, head) => git(["merge-base", "--is-ancestor", base, head]),
  } = {}
) {
  if (
    api.worker !== "api" ||
    !/^[a-f0-9]{40}$/.test(api.revision ?? "") ||
    !/^[a-f0-9]{40}$/.test(revision ?? "")
  )
    throw new Error(
      "API RPC compatibility unverified: release current API first"
    );
  if (api.revision === revision) return;
  try {
    ancestor(api.revision, revision);
    if (impact(diff(api.revision, revision)).cd.includes("api"))
      throw new Error("API artifact changed");
  } catch {
    throw new Error(
      "API RPC compatibility unverified: release current API first"
    );
  }
}

export async function smoke(
  target,
  fetcher = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetcher(
        `${target.url}${target.worker === "web" ? "/" : "/health"}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: { "Cache-Control": "no-cache" },
        }
      );
      if (!response.ok) throw new Error("Unhealthy");
      if (target.worker === "web") {
        if (
          !response.headers.get("content-type")?.includes("text/html") ||
          !(await response.text()).includes('<div id="root">')
        )
          throw new Error("Wrong Web response");
      } else {
        const body = await response.json();
        if (
          body.status !== "ok" ||
          (target.worker === "bot" && body.service !== names.bot)
        )
          throw new Error("Wrong health response");
      }
      return;
    } catch {
      /* Only sanitized failure is emitted after bounded retries. */
    }
    if (attempt < 5) await wait(5000);
  }
  throw new Error(`Health verification failed: ${target.worker}`);
}
