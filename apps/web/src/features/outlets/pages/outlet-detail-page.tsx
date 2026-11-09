import {
  Link,
  useLoaderData,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";

import { ChannelBadge } from "@/components/channel-badge";
import { OperationalRefresh } from "@/components/operational-state";
import { ReadPagination } from "@/components/read-pagination";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { StockReportCard } from "@/features/stock-reports/components/stock-report-card";
import { formatTime } from "@/lib/formatters";

export function OutletDetailPage() {
  const { outlet, visits, stockReports } = useLoaderData({
    from: "/dashboard/outlets/$outletId",
  });
  const search = useSearch({ from: "/dashboard/outlets/$outletId" });
  const navigate = useNavigate({ from: "/outlets/$outletId" });
  const update = (key: "visitOffset" | "reportOffset", offset: number) =>
    void navigate({ search: { ...search, [key]: offset }, resetScroll: false });
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          nativeButton={false}
          variant="ghost"
          render={<Link to="/outlets" search={{}} />}
        >
          Kembali ke Outlet
        </Button>
        <OperationalRefresh />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs break-all">
          Detail Outlet · {outlet.id}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {outlet.name}
        </h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Informasi Outlet</CardTitle>
          <CardDescription>Identitas bisnis dari master data.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">ID bisnis</dt>
              <dd>{outlet.businessId ?? "Belum tersedia"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">No. RS</dt>
              <dd>{outlet.noRs ?? "Belum tersedia"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat kunjungan</CardTitle>
          <CardDescription>
            Terbaru dahulu · WIB · Sesuai akses Anda.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {visits.items.length ? (
            <ul className="divide-y">
              {visits.items.map((visit) => (
                <li
                  key={visit.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link
                      to="/visits/$visitId"
                      params={{ visitId: visit.id }}
                      search={{}}
                      className="font-medium break-all underline-offset-4 hover:underline"
                    >
                      {visit.id}
                    </Link>
                    <span className="text-muted-foreground text-sm">
                      {visit.member?.name ?? visit.salesForceId} ·{" "}
                      {formatTime(visit.visitedAt)} WIB
                    </span>
                  </div>
                  <ChannelBadge channel={visit.submissionChannel} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  Belum ada kunjungan yang dapat Anda akses
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          <ReadPagination
            offset={search.visitOffset}
            count={visits.items.length}
            total={visits.total}
            onChange={(offset) => update("visitOffset", offset)}
          />
        </CardContent>
      </Card>
      <section
        aria-labelledby="outlet-reports-title"
        className="flex flex-col gap-4"
      >
        <h2 id="outlet-reports-title" className="text-lg font-semibold">
          Riwayat laporan stok
        </h2>
        <p className="text-muted-foreground text-sm">
          Sesuai pelapor yang dapat Anda akses, termasuk laporan mandiri. Bukan
          stok terkini.
        </p>
        {stockReports.items.length ? (
          stockReports.items.map((report) => (
            <StockReportCard key={report.id} report={report} />
          ))
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                Belum ada laporan stok yang dapat Anda akses
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
        <ReadPagination
          offset={search.reportOffset}
          count={stockReports.items.length}
          total={stockReports.total}
          onChange={(offset) => update("reportOffset", offset)}
        />
      </section>
    </>
  );
}
