import type { DashboardOverview } from "@sales-visit/contracts";

import { api } from "@/features/auth/session";

const label = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric",
});
export async function loadOverview() {
  const data = await api<DashboardOverview>("/dashboard/overview");
  return {
    ...data,
    dailyVisits: data.dailyVisits.map((entry) => ({
      ...entry,
      label: label.format(new Date(`${entry.date}T00:00:00+07:00`)),
      day: entry.date.slice(-2),
    })),
    channels: data.channels.map((entry) => ({
      ...entry,
      percentage: data.metrics.visits ? entry.count / data.metrics.visits : 0,
    })),
  };
}
export type OverviewData = Awaited<ReturnType<typeof loadOverview>>;
