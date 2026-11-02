import { ArrowLeftIcon, ClipboardTextIcon } from "@phosphor-icons/react";
import { Link, useLoaderData } from "@tanstack/react-router";

import { ChannelBadge } from "@/components/channel-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FieldError } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StockReportCard } from "@/features/stock-reports/components/stock-report-card";
import { formatTime } from "@/lib/formatters";

export function OutletDetailPage() {
  const { outlet, visits, stockReports, storageError } = useLoaderData({
    from: "/dashboard/outlets/$outletId",
  });
  return (
    <>
      <div>
        <Button
          nativeButton={false}
          variant="ghost"
          size="sm"
          render={<Link to="/outlets" search={{}} />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Kembali ke Outlet
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Detail Outlet · {outlet.id}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {outlet.name}
        </h1>
      </div>
      {storageError && <FieldError>{storageError}</FieldError>}
      <Card>
        <CardHeader>
          <CardTitle>Informasi Outlet</CardTitle>
          <CardDescription>Alamat dan kontak Outlet.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs">Alamat</dt>
              <dd className="mt-1">{outlet.address}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Kontak</dt>
              <dd className="mt-1">
                {outlet.contact}
                <a
                  href={`tel:${outlet.phone.replace(/\s/g, "")}`}
                  className="mt-1 block underline underline-offset-4"
                >
                  {outlet.phone}
                </a>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            Riwayat kunjungan <Badge variant="secondary">{visits.length}</Badge>
          </CardTitle>
          <CardDescription>Terbaru dahulu · Waktu dalam WIB</CardDescription>
        </CardHeader>
        <CardContent>
          {visits.length ? (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kunjungan</TableHead>
                      <TableHead>Waktu kunjungan (WIB)</TableHead>
                      <TableHead>Sales Force</TableHead>
                      <TableHead>Kanal pelaporan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visits.map((visit) => (
                      <TableRow key={visit.id}>
                        <TableCell>
                          <Link
                            to="/visits/$visitId"
                            params={{ visitId: visit.id }}
                            search={{}}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {visit.id}
                          </Link>
                          {visit.submittedAt && (
                            <span className="text-muted-foreground mt-1 block text-xs">
                              Tersimpan di browser ini
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{formatTime(visit.visitedAt)}</TableCell>
                        <TableCell>{visit.member.name}</TableCell>
                        <TableCell>
                          <ChannelBadge channel={visit.submissionChannel} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-col gap-3 md:hidden">
                {visits.map((visit) => (
                  <Link
                    key={visit.id}
                    to="/visits/$visitId"
                    params={{ visitId: visit.id }}
                    search={{}}
                    className="focus-visible:outline-ring flex flex-col gap-2 rounded-lg border p-4 text-sm focus-visible:outline-2"
                  >
                    <span className="font-medium">{visit.id}</span>
                    <span>{visit.member.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatTime(visit.visitedAt)} WIB
                    </span>
                    <div>
                      <ChannelBadge channel={visit.submissionChannel} />
                    </div>
                    {visit.submittedAt && (
                      <span className="text-muted-foreground text-xs">
                        Tersimpan di browser ini
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClipboardTextIcon />
                </EmptyMedia>
                <EmptyTitle>Belum ada kunjungan</EmptyTitle>
                <EmptyDescription>
                  Belum ada kunjungan tercatat untuk Outlet ini.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
      <section
        aria-labelledby="outlet-reports-title"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <h2 id="outlet-reports-title" className="text-lg font-semibold">
            Riwayat laporan stok{" "}
            <Badge variant="secondary">{stockReports.length}</Badge>
          </h2>
          <p className="text-muted-foreground text-sm">
            Terbaru dahulu, termasuk laporan tanpa kunjungan. Jumlah dilaporkan
            sesuai waktu pelaporan, bukan stok terkini.
          </p>
        </div>
        {stockReports.length ? (
          stockReports.map((report) => (
            <div key={report.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={report.visitId ? "secondary" : "outline"}>
                  {report.visitId
                    ? "Terkait kunjungan"
                    : "Laporan mandiri · Tanpa kunjungan"}
                </Badge>
                {report.visitId && (
                  <Link
                    to="/visits/$visitId"
                    params={{ visitId: report.visitId }}
                    search={{}}
                    className="underline underline-offset-4"
                  >
                    {report.visitId}
                  </Link>
                )}
              </div>
              <StockReportCard report={report} />
            </div>
          ))
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Belum ada laporan stok</EmptyTitle>
              <EmptyDescription>
                Belum ada laporan stok tercatat untuk Outlet ini.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </>
  );
}
