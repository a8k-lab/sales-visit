import { Link, useRouterState } from "@tanstack/react-router";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { validateVisitSearch } from "@/features/visits/lib/filter-visits";

const pages = [
  { path: "/users", group: "Administrasi", title: "Pengguna & Akses" },
  {
    path: "/master/sales-force",
    group: "Administrasi",
    title: "Kelola Sales Force",
  },
  {
    path: "/supervisor-assignments",
    group: "Administrasi",
    title: "Penugasan Supervisor",
  },
  {
    path: "/visits/new",
    group: "Kunjungan",
    title: "Pelaporan Web belum tersedia",
    parent: "/visits",
  },
  {
    path: "/visits/",
    group: "Kunjungan",
    title: "Detail kunjungan",
    parent: "/visits",
    detail: true,
  },
  {
    path: "/outlets/",
    group: "Outlet",
    title: "Detail Outlet",
    parent: "/outlets",
    detail: true,
  },
  { path: "/visits", title: "Kunjungan" },
  { path: "/outlets", title: "Outlet" },
] as const;
const directoryTitles = {
  "sales-force": "Sales Force",
  products: "Produk",
  "stock-reports": "Laporan stok",
} as const;

export function DashboardBreadcrumbs() {
  const location = useRouterState({ select: (state) => state.location });
  const pathname = location.pathname.replace(/\/+$/, "");
  const page = pages.find((entry) =>
    "detail" in entry
      ? pathname.startsWith(entry.path)
      : pathname === entry.path
  );
  const directoryKind = location.search.kind;
  const directoryTitle = directoryKind && directoryTitles[directoryKind];
  if (!page && pathname !== "/directory") return null;
  const title = page?.title ?? directoryTitle ?? "Sales Force";
  const group =
    page && "group" in page
      ? page.group
      : pathname === "/directory"
        ? directoryKind === "stock-reports"
          ? "Monitoring"
          : "Data / Referensi"
        : undefined;
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {group && (
          <>
            <BreadcrumbItem className="min-w-0 shrink">
              {page && "parent" in page ? (
                <BreadcrumbLink
                  render={
                    <Link
                      to={page.parent}
                      search={
                        page.parent === "/visits"
                          ? validateVisitSearch({
                              ...location.search,
                              offset:
                                typeof location.search.offset === "string"
                                  ? location.search.offset
                                  : undefined,
                            })
                          : {}
                      }
                    />
                  }
                  className="truncate"
                >
                  {group}
                </BreadcrumbLink>
              ) : (
                <span className="truncate">{group}</span>
              )}
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
