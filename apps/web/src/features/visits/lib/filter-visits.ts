import { visitContext, type VisitData } from "@/data/visit-store";

export type VisitFilters = {
  q: string;
  channel: string;
  member: string;
  outlet: string;
  stock: string;
  date: string;
};

export function validateVisitSearch(
  search: Partial<VisitFilters>
): VisitFilters {
  const text = (key: keyof VisitFilters) =>
    typeof search[key] === "string" ? search[key] : "";
  return {
    q: text("q"),
    channel: ["web", "telegram"].includes(text("channel"))
      ? text("channel")
      : "",
    member: text("member"),
    outlet: text("outlet"),
    stock: ["with", "without"].includes(text("stock")) ? text("stock") : "",
    date: /^\d{4}-\d{2}-\d{2}$/.test(text("date")) ? text("date") : "",
  };
}

export function filterVisits(filters: VisitFilters, data: VisitData) {
  const query = filters.q.trim().toLowerCase();
  return data.visits
    .filter((visit) => {
      const { outlet, member, reports } = visitContext(
        visit,
        data.stockReports
      );
      return (
        (!query ||
          [visit.id, outlet.name, member.name, visit.notes ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(query)) &&
        (!filters.channel || visit.submissionChannel === filters.channel) &&
        (!filters.member || visit.salesForceId === filters.member) &&
        (!filters.outlet || visit.outletId === filters.outlet) &&
        (!filters.stock ||
          (filters.stock === "with"
            ? reports.length > 0
            : reports.length === 0)) &&
        (!filters.date ||
          new Date(Date.parse(visit.visitedAt) + 7 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10) === filters.date)
      );
    })
    .toSorted((a, b) => Date.parse(b.visitedAt) - Date.parse(a.visitedAt));
}
