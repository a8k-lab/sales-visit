import type {
  NamedStockReport,
  OutletReadDetail,
  OutletDetail,
  ReadPage,
  Reference,
  VisitListItem,
} from "@sales-visit/contracts";

import { api, currentAccount } from "@/features/auth/session";

export type ManagedOutlet = OutletDetail & { references: string[] };

export function catalogQuery(q: string, offset: number) {
  const query = new URLSearchParams({
    view: "page",
    limit: "25",
    offset: String(offset),
  });
  if (q.trim()) query.set("q", q.trim());
  return query;
}
export const loadOutletDirectory = (q: string, offset: number) =>
  api<ReadPage<Reference>>(`/outlets?${catalogQuery(q, offset)}`);
export async function loadOutletDetail(
  outletId: string,
  visitOffset: number,
  reportOffset: number
) {
  const managed =
    currentAccount()?.role === "admin"
      ? await api<ManagedOutlet>(
          `/admin/outlets/detail?${new URLSearchParams({ id: outletId })}`
        )
      : null;
  const outlet =
    managed ??
    (await api<OutletReadDetail>(`/outlets/${encodeURIComponent(outletId)}`));
  const query = new URLSearchParams({ view: "page", limit: "25", outletId });
  const [visits, stockReports] = await Promise.all([
    api<ReadPage<VisitListItem>>(`/visits?${query}&offset=${visitOffset}`),
    api<ReadPage<NamedStockReport>>(
      `/stock-reports?${query}&offset=${reportOffset}`
    ),
  ]);
  return { outlet, managed, visits, stockReports };
}
export const validOffset = (value: unknown) =>
  /^\d{1,6}$/.test(String(value)) && Number(value) <= 100000
    ? Number(value)
    : 0;
