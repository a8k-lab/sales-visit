import type { Visit } from "./visit.ts";

export interface Reference {
  id: string;
  name: string;
}
export type NamedVisit = Visit & {
  outlet: Reference | null;
  member: Reference | null;
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
