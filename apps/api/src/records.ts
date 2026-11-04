import type { StockReport, Visit } from "@sales-visit/contracts";
import type { stockReportItems, stockReports, visits } from "@sales-visit/db";

export function toVisit(row: typeof visits.$inferSelect): Visit {
  return {
    id: row.id,
    outletId: row.outletId,
    salesForceId: row.salesForceId,
    visitedAt: row.visitedAt.toISOString(),
    submissionChannel: row.submissionChannel,
    notes: row.notes ?? undefined,
    followUp: row.followUp ?? undefined,
  };
}

export function toStockReport(
  row: typeof stockReports.$inferSelect & {
    items: (typeof stockReportItems.$inferSelect)[];
  }
): StockReport {
  return {
    id: row.id,
    outletId: row.outletId,
    reporterSalesForceId: row.reporterSalesForceId,
    visitId: row.visitId ?? undefined,
    reportedAt: row.reportedAt.toISOString(),
    submissionChannel: row.submissionChannel,
    items: row.items.map(({ productId, quantity }) => ({
      productId,
      quantity,
    })),
  };
}
