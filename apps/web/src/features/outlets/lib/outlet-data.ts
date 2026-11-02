import { outlets } from "@/data/mock-data";
import {
  loadVisitData,
  visitContext,
  type VisitData,
} from "@/data/visit-store";

function outletVisits(outletId: string, data: VisitData) {
  return data.visits
    .filter((visit) => visit.outletId === outletId)
    .toSorted((a, b) => Date.parse(b.visitedAt) - Date.parse(a.visitedAt));
}

export function loadOutletDirectory() {
  const data = loadVisitData();
  return {
    storageError: data.storageError,
    outlets: outlets.map((outlet) => {
      const visits = outletVisits(outlet.id, data);
      return {
        ...outlet,
        visitCount: visits.length,
        lastVisitedAt: visits[0]?.visitedAt,
      };
    }),
  };
}

export function searchOutlets<T extends (typeof outlets)[number]>(
  entries: T[],
  query: string
): T[] {
  const term = query.trim().toLocaleLowerCase("id-ID");
  return entries.filter((outlet) =>
    [outlet.name, outlet.address, outlet.contact, outlet.phone].some((value) =>
      value.toLocaleLowerCase("id-ID").includes(term)
    )
  );
}

export function loadOutletDetail(outletId: string) {
  const outlet = outlets.find((entry) => entry.id === outletId);
  if (!outlet) return undefined;
  const data = loadVisitData();
  return {
    outlet,
    storageError: data.storageError,
    visits: outletVisits(outletId, data).map((visit) => ({
      ...visit,
      member: visitContext(visit, data.stockReports).member,
    })),
    // Independent reports belong to the Outlet too; never derive this from Visits.
    stockReports: data.stockReports
      .filter((report) => report.outletId === outletId)
      .toSorted((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt)),
  };
}
