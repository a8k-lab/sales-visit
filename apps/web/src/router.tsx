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
          Kunjungan atau halaman yang Anda cari tidak tersedia.
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

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    visitsRoute,
    newVisitRoute,
    detailRoute,
    directoryRoute,
  ]),
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
