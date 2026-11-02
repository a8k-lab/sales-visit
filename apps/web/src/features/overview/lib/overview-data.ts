import { outlets, salesForce } from "@/data/mock-data";
import { loadVisitData, type VisitData } from "@/data/visit-store";

const dayMilliseconds = 24 * 60 * 60 * 1000;
const jakartaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateLabel = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// Calendar keys use Jakarta, independent of the browser's timezone.
function dateKey(timestamp: string) {
  const parts = jakartaDate.formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function summarizeOverview(data: VisitData) {
  const visits = data.visits.toSorted(
    (a, b) => Date.parse(b.visitedAt) - Date.parse(a.visitedAt)
  );
  const counts = new Map<string, number>();
  const channelCounts = { web: 0, telegram: 0 };
  for (const visit of visits) {
    const key = dateKey(visit.visitedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    channelCounts[visit.submissionChannel] += 1;
  }

  // Bound the chart to 14 calendar days ending at the latest Visit, not today:
  // fixtures remain useful even when the prototype is viewed on another date.
  const latestDate = visits[0] ? dateKey(visits[0].visitedAt) : undefined;
  const dailyVisits = latestDate
    ? Array.from({ length: 14 }, (_, index) => {
        const date = new Date(
          Date.parse(`${latestDate}T00:00:00+07:00`) -
            (13 - index) * dayMilliseconds
        );
        const key = dateKey(date.toISOString());
        return {
          date: key,
          label: dateLabel.format(date),
          day: key.slice(-2),
          count: counts.get(key) ?? 0,
        };
      })
    : [];

  return {
    storageError: data.storageError,
    metrics: {
      visits: visits.length,
      outlets: new Set(visits.map((visit) => visit.outletId)).size,
      salesForce: new Set(visits.map((visit) => visit.salesForceId)).size,
      stockReports: data.stockReports.length,
    },
    dailyVisits,
    channels: (["web", "telegram"] as const).map((channel) => ({
      channel,
      count: channelCounts[channel],
      percentage: visits.length ? channelCounts[channel] / visits.length : 0,
    })),
    recentVisits: visits.slice(0, 5).map((visit) => ({
      ...visit,
      outlet: outlets.find((outlet) => outlet.id === visit.outletId)!,
      member: salesForce.find((member) => member.id === visit.salesForceId)!,
    })),
  };
}

export function loadOverview() {
  return summarizeOverview(loadVisitData());
}

export type OverviewData = ReturnType<typeof summarizeOverview>;
