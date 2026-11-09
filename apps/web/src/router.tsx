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
import {
  OperationalError,
  OperationalPending,
} from "@/components/operational-state";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { LoginPage } from "@/features/auth/pages/login-page";
import { ApiError, restoreSession, safeReturn } from "@/features/auth/session";
import {
  loadDirectory,
  type DirectoryKind,
} from "@/features/directory/directory-data";
import { DirectoryPage } from "@/features/directory/pages/directory-page";
import {
  loadOutletDetail,
  loadOutletDirectory,
  validOffset,
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
import { loadVisits, loadVisit } from "@/features/visits/lib/visit-reads";
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

async function orNotFound<T>(request: Promise<T>) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw notFound();
    throw error;
  }
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
  pendingComponent: OperationalPending,
  errorComponent: OperationalError,
  loader: loadOverview,
  component: OverviewPage,
});
const visitsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/visits",
  validateSearch: visitSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadVisits(deps),
  pendingComponent: OperationalPending,
  errorComponent: OperationalError,
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
  loader: ({ params }) => orNotFound(loadVisit(params.visitId)),
  pendingComponent: OperationalPending,
  errorComponent: OperationalError,
  component: VisitDetailPage,
  notFoundComponent: NotFoundPage,
});
const directoryRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/directory",
  validateSearch: (
    search: SearchSchemaInput & {
      kind?: DirectoryKind;
      q?: string;
      offset?: number;
    }
  ) => ({
    kind: (["sales-force", "products", "stock-reports"].includes(
      search.kind ?? ""
    )
      ? search.kind
      : "sales-force") as DirectoryKind,
    q: typeof search.q === "string" ? search.q.slice(0, 200) : "",
    offset: validOffset(search.offset),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadDirectory(deps.kind, deps.q, deps.offset),
  pendingComponent: OperationalPending,
  errorComponent: OperationalError,
  component: DirectoryPage,
});

const assignmentsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/supervisor-assignments",
  component: AssignmentsPage,
});

const outletsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/outlets",
  validateSearch: (
    search: SearchSchemaInput & { q?: string; offset?: number }
  ) => ({
    q: typeof search.q === "string" ? search.q.slice(0, 200) : "",
    offset: validOffset(search.offset),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadOutletDirectory(deps.q, deps.offset),
  pendingComponent: OperationalPending,
  errorComponent: OperationalError,
  component: OutletsPage,
});
const outletDetailRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/outlets/$outletId",
  validateSearch: (
    search: SearchSchemaInput & { visitOffset?: number; reportOffset?: number }
  ) => ({
    visitOffset: validOffset(search.visitOffset),
    reportOffset: validOffset(search.reportOffset),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    orNotFound(
      loadOutletDetail(params.outletId, deps.visitOffset, deps.reportOffset)
    ),
  pendingComponent: OperationalPending,
  errorComponent: OperationalError,
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
