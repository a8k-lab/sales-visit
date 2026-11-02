import {
  ArrowLeftIcon,
  ClipboardTextIcon,
  MapPinIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { Link, useLoaderData, useSearch } from "@tanstack/react-router";

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
import { visitContext } from "@/data/visit-store";
import { StockReportCard } from "@/features/stock-reports/components/stock-report-card";
import { formatTime } from "@/lib/formatters";

export function VisitDetailPage() {
  const { visit, stockReports } = useLoaderData({ from: "/visits/$visitId" });
  const filters = useSearch({ from: "/visits/$visitId" });
  const { outlet, member, reports } = visitContext(visit, stockReports);
  return (
    <>
      <div>
        <Button
          nativeButton={false}
          variant="ghost"
          size="sm"
          render={<Link to="/visits" search={filters} />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Kembali ke kunjungan
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-widest break-all uppercase">
          Detail kunjungan · {visit.id}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {outlet.name}
        </h1>
        <p className="text-muted-foreground text-sm">
          Dikunjungi oleh {member.name} · {formatTime(visit.visitedAt)} WIB
        </p>
      </div>
      {visit.submittedAt && (
        <p role="status" className="text-muted-foreground text-sm">
          Kunjungan tersimpan di browser ini · {formatTime(visit.submittedAt)}{" "}
          WIB. Belum dikirim ke server.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPinIcon className="size-4" />
              Informasi Outlet
            </CardTitle>
            <CardDescription>{outlet.id}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Outlet</dt>
                <dd className="mt-1 font-medium">
                  <Link
                    to="/outlets/$outletId"
                    params={{ outletId: outlet.id }}
                    className="underline underline-offset-4"
                  >
                    {outlet.name}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Alamat</dt>
                <dd className="mt-1">{outlet.address}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Kontak</dt>
                <dd className="mt-1">
                  {outlet.contact} · {outlet.phone}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="size-4" />
              Sales Force dan informasi kunjungan
            </CardTitle>
            <CardDescription>
              Petugas dan kanal pelaporan kunjungan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Sales Force</dt>
                <dd className="mt-1 font-medium">{member.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Wilayah</dt>
                <dd className="mt-1">{member.territory}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">
                  ID Sales Force
                </dt>
                <dd className="mt-1">{member.id}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">
                  Kanal pelaporan
                </dt>
                <dd className="mt-1">
                  <ChannelBadge channel={visit.submissionChannel} />
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground text-xs">
                  Waktu kunjungan (WIB)
                </dt>
                <dd className="mt-1 tabular-nums">
                  {formatTime(visit.visitedAt)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Hasil kunjungan</CardTitle>
          <CardDescription>
            Catatan dan tindak lanjut kunjungan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-5 text-sm">
            <div>
              <dt className="text-muted-foreground mb-2 text-xs font-medium">
                Catatan
              </dt>
              <dd className="leading-relaxed break-words whitespace-pre-wrap">
                {visit.notes || "Belum ada catatan."}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground mb-2 text-xs font-medium">
                Tindak lanjut
              </dt>
              <dd className="leading-relaxed break-words whitespace-pre-wrap">
                {visit.followUp || "Belum ada tindak lanjut."}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <section aria-labelledby="stock-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2
              id="stock-heading"
              className="text-lg font-semibold tracking-tight"
            >
              Laporan stok terkait
            </h2>
            <Badge variant="secondary">{reports.length}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Jumlah stok dicatat sesuai waktu pelaporan, bukan stok terkini.
          </p>
        </div>
        {reports.length ? (
          reports.map((report) => (
            <StockReportCard key={report.id} report={report} />
          ))
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardTextIcon />
              </EmptyMedia>
              <EmptyTitle>
                Belum ada laporan stok untuk kunjungan ini
              </EmptyTitle>
              <EmptyDescription>
                Kunjungan ini dicatat tanpa laporan stok.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </>
  );
}
