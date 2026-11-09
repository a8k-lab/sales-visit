import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  notFound,
  Outlet,
  redirect,
  useRouter,
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
import { LoginPage } from "@/features/auth/pages/login-page";
import {
  currentAccount,
  restoreSession,
  safeReturn,
} from "@/features/auth/session";
import { DirectoryPage } from "@/features/directory/pages/directory-page";
import {
  loadOutletDetail,
  loadOutletDirectory,
} from "@/features/outlets/lib/outlet-data";
import { OutletDetailPage } from "@/features/outlets/pages/outlet-detail-page";
import { OutletsPage } from "@/features/outlets/pages/outlets-page";
import { loadOverview } from "@/features/overview/lib/overview-data";
import { OverviewPage } from "@/features/overview/pages/overview-page";
import { AssignmentsPage } from "@/features/supervisor-assignments/pages/assignments-page";
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

function SessionUnavailable() {
  const router = useRouter();
  return (
    <Empty>
      <EmptyHeader role="alert">
        <EmptyTitle>Sesi belum dapat diperiksa</EmptyTitle>
        <EmptyDescription>
          Periksa koneksi lalu coba lagi. Sesi tersimpan tidak dihapus.
        </EmptyDescription>
      </EmptyHeader>
      <Button onClick={() => void router.invalidate()}>Coba lagi</Button>
    </Empty>
  );
}

const visitSearch = (search: SearchSchemaInput & Partial<VisitFilters>) =>
  validateVisitSearch(search);

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "dashboard",
  beforeLoad: async ({ location }) => {
    const account = await restoreSession();
    if (!account)
      throw redirect({
        to: "/login",
        search: { redirect: safeReturn(location.href) },
        replace: true,
      });
  },
  pendingComponent: () => <p role="status">Memeriksa sesi…</p>,
  errorComponent: SessionUnavailable,
  component: DashboardLayout,
  notFoundComponent: NotFoundPage,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeReturn(search.redirect),
  }),
  component: LoginPage,
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/overview", replace: true });
  },
});
const overviewRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/overview",
  loader: loadOverview,
  component: OverviewPage,
});
const visitsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/visits",
  validateSearch: visitSearch,
  loader: loadVisitData,
  component: VisitsPage,
});
const newVisitRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/visits/new",
  validateSearch: visitSearch,
  component: NewVisitPage,
});
const detailRoute = createRoute({
  getParentRoute: () => dashboardRoute,
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
  getParentRoute: () => dashboardRoute,
  path: "/directory",
  loader: loadVisitData,
  component: () =>
    currentAccount()?.role === "sales_force" ? (
      <p role="alert">
        Akses tidak diizinkan. Halaman pemantauan hanya untuk Admin dan
        Supervisor.
      </p>
    ) : (
      <DirectoryPage />
    ),
});

const assignmentsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/supervisor-assignments",
  component: AssignmentsPage,
});

const outletsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/outlets",
  validateSearch: (search: SearchSchemaInput & { q?: string }) => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  loader: loadOutletDirectory,
  component: OutletsPage,
});
const outletDetailRoute = createRoute({
  getParentRoute: () => dashboardRoute,
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
    loginRoute,
    dashboardRoute.addChildren([
      overviewRoute,
      assignmentsRoute,
      visitsRoute,
      newVisitRoute,
      detailRoute,
      directoryRoute,
      outletsRoute,
      outletDetailRoute,
    ]),
  ]),
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
