import type { Visit } from "./visit.ts";

export interface Reference {
  id: string;
  name: string;
}
export type NamedVisit = Visit & {
  outlet: Reference | null;
  member: Reference | null;
};
export interface ReadPage<T> {
  items: T[];
  total: number;
}
export type VisitListItem = NamedVisit & { stockReportCount: number };
export type NamedStockReport = import("./stock-report.ts").StockReport & {
  reporter: Reference | null;
  items: (import("./stock-report.ts").StockReportItem & {
    product: Reference | null;
  })[];
};
export type VisitDetail = NamedVisit & { stockReports: NamedStockReport[] };
export type OutletReadDetail = Reference & {
  businessId: string | null;
  noRs: string | null;
};
export interface DashboardOverview {
  period: { start: string; end: string; timeZone: string };
  metrics: {
    visits: number;
    outlets: number;
    salesForce: number;
    stockReports: number;
  };
  dailyVisits: { date: string; count: number }[];
  channels: { channel: "web" | "telegram"; count: number }[];
  recentVisits: NamedVisit[];
}
