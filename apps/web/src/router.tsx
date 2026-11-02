import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  notFound,
  redirect,
  type SearchSchemaInput,
} from "@tanstack/react-router";

import { DashboardLayout } from "@/app/layouts/dashboard-layout";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { loadVisitData } from "@/data/visit-store";
import { DirectoryPage } from "@/features/directory/pages/directory-page";
import {
  loadOutletDetail,
  loadOutletDirectory,
} from "@/features/outlets/lib/outlet-data";
import { OutletDetailPage } from "@/features/outlets/pages/outlet-detail-page";
import { OutletsPage } from "@/features/outlets/pages/outlets-page";
import {
  validateVisitSearch,
  type VisitFilters,
} from "@/features/visits/lib/filter-visits";
import { NewVisitPage } from "@/features/visits/pages/new-visit-page";
import { VisitDetailPage } from "@/features/visits/pages/visit-detail-page";
import { VisitsPage } from "@/features/visits/pages/visits-page";

function NotFoundPage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Data atau halaman tidak ditemukan</EmptyTitle>
        <EmptyDescription>
          Data atau halaman yang Anda cari tidak tersedia.
        </EmptyDescription>
      </EmptyHeader>
      <Button nativeButton={false} render={<Link to="/visits" search={{}} />}>
        Kembali ke kunjungan
      </Button>
    </Empty>
  );
}

const visitSearch = (search: SearchSchemaInput & Partial<VisitFilters>) =>
  validateVisitSearch(search);

const rootRoute = createRootRoute({
  component: DashboardLayout,
  notFoundComponent: NotFoundPage,
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/visits", search: {} });
  },
});
const visitsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/visits",
  validateSearch: visitSearch,
  loader: loadVisitData,
  component: VisitsPage,
});
const newVisitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/visits/new",
  validateSearch: visitSearch,
  component: NewVisitPage,
});
const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/visits/$visitId",
  validateSearch: visitSearch,
  loader: ({ params }) => {
    const data = loadVisitData();
    const visit = data.visits.find((item) => item.id === params.visitId);
    if (!visit) throw notFound();
    return { visit, stockReports: data.stockReports };
  },
  component: VisitDetailPage,
  notFoundComponent: NotFoundPage,
});
const directoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/directory",
  loader: loadVisitData,
  component: DirectoryPage,
});

const outletsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/outlets",
  validateSearch: (search: SearchSchemaInput & { q?: string }) => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  loader: loadOutletDirectory,
  component: OutletsPage,
});
const outletDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/outlets/$outletId",
  loader: ({ params }) => {
    const data = loadOutletDetail(params.outletId);
    if (!data) throw notFound();
    return data;
  },
  component: OutletDetailPage,
  notFoundComponent: NotFoundPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    visitsRoute,
    newVisitRoute,
    detailRoute,
    directoryRoute,
    outletsRoute,
    outletDetailRoute,
  ]),
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
