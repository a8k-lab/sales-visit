import {
  createOutletSchema,
  updateOutletSchema,
  outletKeySchema,
  outletListSchema,
  outletDetailSchema,
  type BotActor,
  type OutletDetail,
  type PlanningResult,
  type PlanningPage,
} from "@sales-visit/contracts";

import { planningBatch } from "./planning-access.ts";

const fields = "id, name, created_at AS createdAt, updated_at AS updatedAt";
// D1 stores signed 64-bit integers; validate before conversion to JS numbers.
// Reject rather than implicitly repair either timestamp during a mutation.
const reportableTimestamps = `typeof(created_at) = 'integer'
  AND created_at BETWEEN -9007199254740991 AND 9007199254740991
  AND (updated_at IS NULL OR (typeof(updated_at) = 'integer'
    AND updated_at BETWEEN -9007199254740991 AND 9007199254740991))`;
const unreferenced = `NOT EXISTS (SELECT 1 FROM visits WHERE outlet_id = outlets.id)
  AND NOT EXISTS (SELECT 1 FROM stock_reports WHERE outlet_id = outlets.id)
  AND NOT EXISTS (SELECT 1 FROM visit_schedules WHERE outlet_id = outlets.id)`;

export class OutletOperations {
  constructor(private db: D1Database) {}

  async list(
    actor: BotActor,
    input: unknown = {}
  ): Promise<PlanningResult<PlanningPage<OutletDetail>>> {
    const parsed = outletListSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const result = await planningBatch(
      this.db,
      actor,
      "monitoring",
      (guard) => [
        {
          sql: `SELECT ${fields} FROM outlets WHERE id > ? AND ${guard} ORDER BY id LIMIT 51`,
          values: [parsed.data.after ?? ""],
        },
      ]
    );
    if (!result.ok) return result;
    const rows = result.data[0]!.results.map((row) =>
      outletDetailSchema.parse(row)
    );
    const items = rows.slice(0, 50);
    return {
      ok: true,
      data: { items, next: rows.length > 50 ? items.at(-1)!.id : null },
    };
  }

  async get(
    actor: BotActor,
    input: unknown
  ): Promise<PlanningResult<OutletDetail>> {
    const parsed = outletKeySchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const result = await planningBatch(
      this.db,
      actor,
      "monitoring",
      (guard) => [
        {
          sql: `SELECT ${fields} FROM outlets WHERE id = ? AND ${guard}`,
          values: [parsed.data.id],
        },
      ]
    );
    if (!result.ok) return result;
    const row = outletDetailSchema.optional().parse(result.data[0]!.results[0]);
    return row ? { ok: true, data: row } : { ok: false, code: "not_found" };
  }

  async create(
    actor: BotActor,
    input: unknown
  ): Promise<PlanningResult<OutletDetail>> {
    const parsed = createOutletSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const result = await planningBatch(this.db, actor, "admin", (guard) => [
      {
        sql: `INSERT INTO outlets (id, name, updated_at) SELECT ?, ?, unixepoch() * 1000 WHERE ${guard} RETURNING ${fields}`,
        values: [crypto.randomUUID(), parsed.data.name],
      },
    ]);
    if (!result.ok) return result;
    return {
      ok: true,
      data: outletDetailSchema.parse(result.data[0]!.results[0]),
    };
  }

  async update(
    actor: BotActor,
    input: unknown
  ): Promise<PlanningResult<OutletDetail>> {
    const parsed = updateOutletSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const result = await planningBatch(this.db, actor, "admin", (guard) => [
      {
        sql: `UPDATE outlets SET name = ?, updated_at = unixepoch() * 1000 WHERE id = ? AND ${guard} AND ${reportableTimestamps} RETURNING ${fields}`,
        values: [parsed.data.name, parsed.data.id],
      },
      {
        sql: `SELECT id FROM outlets WHERE id = ? AND ${guard}`,
        values: [parsed.data.id],
      },
    ]);
    if (!result.ok) return result;
    const row = outletDetailSchema.optional().parse(result.data[0]!.results[0]);
    if (row) return { ok: true, data: row };
    return {
      ok: false,
      code: result.data[1]!.results.length ? "unavailable" : "not_found",
    };
  }

  async delete(
    actor: BotActor,
    input: unknown
  ): Promise<PlanningResult<OutletDetail>> {
    const parsed = outletKeySchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const result = await planningBatch(this.db, actor, "admin", (guard) => [
      {
        sql: `DELETE FROM outlets WHERE id = ? AND ${guard} AND ${reportableTimestamps} AND ${unreferenced} RETURNING ${fields}`,
        values: [parsed.data.id],
      },
      {
        sql: `SELECT (${reportableTimestamps}) AS reportable FROM outlets WHERE id = ? AND ${guard}`,
        values: [parsed.data.id],
      },
    ]);
    if (!result.ok) return result;
    const row = outletDetailSchema.optional().parse(result.data[0]!.results[0]);
    if (row) return { ok: true, data: row };
    const existing = result.data[1]!.results[0];
    if (!existing) return { ok: false, code: "not_found" };
    if (
      typeof existing === "object" &&
      "reportable" in existing &&
      existing.reportable === 1
    )
      return { ok: false, code: "referenced" };
    return { ok: false, code: "unavailable" };
  }
}
