import {
  createStockReportSchema,
  createVisitSchema,
  idempotencyKeySchema,
  type StockReport,
  type SubmissionChannel,
  type Visit,
} from "@sales-visit/contracts";
import {
  type Database,
  stockReportItems,
  stockReports,
  visits,
  sql,
} from "@sales-visit/db";

import { toStockReport, toVisit } from "./records.ts";

// Only the private draft boundary constructs this additional atomic guard.
export type TelegramVisitGuard = {
  telegramUserId: string;
  userId: string;
  draftKey: string;
};

// Only an authentication boundary may construct this context, never request JSON.
export type TrustedIdentity = {
  salesForceId: string;
  submissionChannel: SubmissionChannel;
};

export class OperationError extends Error {
  status: 400 | 401 | 404 | 409;

  constructor(status: 400 | 401 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

async function submissionId(
  identity: TrustedIdentity,
  key: unknown,
  operation: "visit" | "stock-report"
) {
  const parsed = idempotencyKeySchema.safeParse(key);
  if (!parsed.success) throw new OperationError(400, "Invalid Idempotency-Key");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        "write-v1",
        operation,
        identity.salesForceId,
        identity.submissionChannel,
        parsed.data.toLowerCase(),
      ])
    )
  );
  return `${operation}-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function validateReferences(
  db: Database,
  identity: TrustedIdentity,
  outletId: string,
  report?: { visitId?: string; items: { productId: string }[] }
) {
  const actor = await db.query.salesForce.findFirst({
    where: (table, { eq }) => eq(table.id, identity.salesForceId),
  });
  if (!actor) throw new OperationError(401, "Unauthorized");
  const outlet = await db.query.outlets.findFirst({
    where: (table, { eq }) => eq(table.id, outletId),
  });
  if (!outlet) throw new OperationError(404, "Outlet not found");
  const visitId = report?.visitId;
  if (visitId) {
    const visit = await db.query.visits.findFirst({
      where: (table, { eq }) => eq(table.id, visitId),
    });
    if (!visit) throw new OperationError(404, "Visit not found");
    if (visit.outletId !== outletId)
      throw new OperationError(400, "Visit belongs to another Outlet");
  }
  if (report) {
    const ids = report.items.map((item) => item.productId);
    const products = await db.query.products.findMany({
      where: (table, { inArray }) => inArray(table.id, ids),
    });
    if (products.length !== ids.length)
      throw new OperationError(404, "Product not found");
  }
}

function reportStatements(db: Database, report: StockReport) {
  return [
    db.insert(stockReports).values({
      ...report,
      reportedAt: new Date(report.reportedAt),
    }),
    ...report.items.map((item) =>
      db.insert(stockReportItems).values({ ...item, stockReportId: report.id })
    ),
  ] as const;
}

async function readReport(db: Database, id: string) {
  const row = await db.query.stockReports.findFirst({
    where: (table, { eq }) => eq(table.id, id),
    with: { items: { orderBy: (table, { asc }) => [asc(table.productId)] } },
  });
  if (!row) return undefined;
  const report = toStockReport(row);
  return { ...report, items: sortedItems(report.items) };
}

// Compare normalized public fields, not createdAt or JSON property order.
function equal(actual: unknown, expected: unknown): boolean {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return canonical(
        Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .toSorted(([a], [b]) => a.localeCompare(b))
      );
    return JSON.stringify(value);
  };
  return canonical(actual) === canonical(expected);
}

function assertRetry(actual: unknown, expected: unknown) {
  if (!equal(actual, expected))
    throw new OperationError(409, "Conflicting submission");
}

function sortedItems(items: StockReport["items"]) {
  // Match SQLite BINARY collation, not JavaScript's UTF-16 string order.
  const encoder = new TextEncoder();
  return items.toSorted((a, b) => {
    const left = encoder.encode(a.productId);
    const right = encoder.encode(b.productId);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      // Both indexes are in bounds by the minimum-length loop condition.
      if (left[i] !== right[i]) return left[i]! - right[i]!;
    }
    return left.length - right.length;
  });
}

export async function createVisit(
  db: Database,
  identity: TrustedIdentity,
  key: unknown,
  input: unknown,
  telegram?: TelegramVisitGuard
) {
  const parsed = createVisitSchema.safeParse(input);
  if (!parsed.success) throw new OperationError(400, "Invalid request");
  const data = parsed.data;
  // Never let an RPC caller supply attribution. Authorization is checked before
  // replay AND inside the INSERT's D1 batch, serializing against account changes.
  const guard = telegram
    ? sql`EXISTS (
    SELECT 1 FROM users u
    JOIN telegram_identities t ON t.user_id = u.id
    JOIN sales_force sf ON sf.id = u.sales_force_id
    JOIN telegram_visit_drafts d ON d.user_id = u.id
    WHERE u.id = ${telegram.userId} AND t.telegram_user_id = ${telegram.telegramUserId}
      AND u.status = 'active' AND u.role = 'sales_force'
      AND sf.id = ${identity.salesForceId} AND d.sales_force_id = sf.id
      AND d.submission_key = ${telegram.draftKey} AND d.submission_key = ${key}
      AND d.step IN ('submitting', 'submitted')
  )`
    : undefined;
  if (guard) {
    if (identity.submissionChannel !== "telegram" || data.stockReport)
      throw new OperationError(400, "Invalid Telegram submission");
    if (!(await db.get(sql`SELECT 1 WHERE ${guard}`)))
      throw new OperationError(401, "Unauthorized");
  }
  const id = await submissionId(identity, key, "visit");
  const visit: Visit = {
    id,
    outletId: data.outletId,
    salesForceId: identity.salesForceId,
    submissionChannel: identity.submissionChannel,
    visitedAt: data.visitedAt,
    notes: data.notes,
    followUp: data.followUp,
  };
  const report: StockReport | undefined = data.stockReport
    ? {
        id: `${id}-stock`,
        outletId: data.outletId,
        reporterSalesForceId: identity.salesForceId,
        submissionChannel: identity.submissionChannel,
        visitId: id,
        reportedAt: data.stockReport.reportedAt,
        items: sortedItems(data.stockReport.items),
      }
    : undefined;
  const result = { ...visit, stockReports: report ? [report] : [] };
  const retry = async () => {
    const row = await db.query.visits.findFirst({
      where: (table, { eq }) => eq(table.id, id),
    });
    if (!row) return false;
    assertRetry(toVisit(row), visit);
    assertRetry(await readReport(db, `${id}-stock`), report);
    return true;
  };
  // Check retries before references: changed payloads must still be conflicts.
  if (await retry()) return { data: result, replayed: true };
  await validateReferences(db, identity, data.outletId, data.stockReport);
  try {
    // D1 batch is atomic; do not use unsupported interactive transactions.
    await db.batch([
      guard
        ? db.insert(visits).select(sql`SELECT ${id}, ${visit.outletId},
            ${visit.salesForceId}, ${Date.parse(visit.visitedAt)}, 'telegram',
            ${visit.notes ?? null}, ${visit.followUp ?? null}, ${Date.now()}
            WHERE ${guard}`)
        : db
            .insert(visits)
            .values({ ...visit, visitedAt: new Date(visit.visitedAt) }),
      ...(report ? reportStatements(db, report) : []),
    ]);
  } catch (error) {
    // A concurrent identical request may have won the primary-key race.
    if (await retry()) return { data: result, replayed: true };
    throw error;
  }
  if (guard && !(await retry())) throw new OperationError(401, "Unauthorized");
  return { data: result, replayed: false };
}

export async function createStockReport(
  db: Database,
  identity: TrustedIdentity,
  key: unknown,
  input: unknown
) {
  const parsed = createStockReportSchema.safeParse(input);
  if (!parsed.success) throw new OperationError(400, "Invalid request");
  const data = parsed.data;
  const id = await submissionId(identity, key, "stock-report");
  const report: StockReport = {
    ...data,
    id,
    reporterSalesForceId: identity.salesForceId,
    submissionChannel: identity.submissionChannel,
    items: sortedItems(data.items),
  };
  const retry = async () => {
    const existing = await readReport(db, id);
    if (!existing) return false;
    assertRetry(existing, report);
    return true;
  };
  if (await retry()) return { data: report, replayed: true };
  await validateReferences(db, identity, data.outletId, data);
  try {
    await db.batch(reportStatements(db, report));
  } catch (error) {
    if (await retry()) return { data: report, replayed: true };
    throw error;
  }
  return { data: report, replayed: false };
}
