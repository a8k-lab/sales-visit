import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  notFound,
  redirect,
  type SearchSchemaInput,
} from "@tanstack/react-router";

import { DashboardLayout } from "@/components/dashboard-layout";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { visits } from "@/data/mock-data";
import { validateVisitSearch, type VisitFilters } from "@/data/visits";
import { DirectoryPage } from "@/pages/directory-page";
import { VisitDetailPage } from "@/pages/visit-detail-page";
import { VisitsPage } from "@/pages/visits-page";

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
  component: VisitsPage,
});
const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/visits/$visitId",
  validateSearch: visitSearch,
  loader: ({ params }) => {
    const visit = visits.find((item) => item.id === params.visitId);
    if (!visit) throw notFound();
    return visit;
  },
  component: VisitDetailPage,
  notFoundComponent: NotFoundPage,
});
const directoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/directory",
  component: DirectoryPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    visitsRoute,
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
