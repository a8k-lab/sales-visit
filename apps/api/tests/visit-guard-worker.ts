// Test-only race injector; never referenced by the deployed entrypoint.
import { createDb } from "@sales-visit/db";

import { createVisit, OperationError } from "../src/operations.ts";

export default {
  async fetch(_request: Request, env: { DB: D1Database }) {
    const row = await env.DB.prepare(
      "SELECT submission_key, payload FROM telegram_visit_drafts WHERE user_id = 'u3'"
    ).first<{ submission_key: string; payload: string }>();
    if (!row) return new Response("Missing synthetic fixture", { status: 400 });
    const db = createDb({
      prepare: env.DB.prepare.bind(env.DB),
      // Revoke AFTER preflight authorization/reference reads, immediately
      // before the actual guarded D1 insert batch.
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.prepare(
          "UPDATE users SET status = 'disabled' WHERE id = 'u3'"
        ).run();
        return env.DB.batch(statements);
      },
    } as D1Database);
    let payload;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      return new Response(null, { status: 400 });
    }
    try {
      await createVisit(
        db,
        { salesForceId: "sf", submissionChannel: "telegram" },
        row.submission_key,
        {
          outletId: payload.outletId,
          visitedAt: payload.visitedAt,
          notes: payload.notes,
          followUp: payload.followUp,
        },
        { userId: "u3", telegramUserId: "3", draftKey: row.submission_key }
      );
      return new Response("Unexpected insertion", { status: 500 });
    } catch (error) {
      return new Response(null, {
        status: error instanceof OperationError ? error.status : 500,
      });
    }
  },
};
