import {
  ArrowRightIcon,
  ClipboardTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import type { VisitListItem } from "@sales-visit/contracts";
import {
  Link,
  useLoaderData,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";

import { ChannelBadge } from "@/components/channel-badge";
import { OperationalRefresh } from "@/components/operational-state";
import { ReadPagination } from "@/components/read-pagination";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilterSelect } from "@/features/visits/components/filter-select";
import type { VisitFilters } from "@/features/visits/lib/filter-visits";

function visitContext(visit: VisitListItem) {
  return {
    outlet: visit.outlet ?? { id: visit.outletId, name: visit.outletId },
    member: visit.member ?? {
      id: visit.salesForceId,
      name: visit.salesForceId,
    },
    reports: { length: visit.stockReportCount },
  };
}
import { formatTime } from "@/lib/formatters";

export function VisitsPage() {
  const filters = useSearch({ from: "/dashboard/visits" });
  const navigate = useNavigate({ from: "/visits" });
  const data = useLoaderData({ from: "/dashboard/visits" });
  const results = data.items;
  const update = (key: keyof VisitFilters, value: string) =>
    void navigate({
      search: (previous: VisitFilters) => ({
        ...previous,
        offset: "",
        [key]: value,
      }),
      replace: true,
      resetScroll: false,
    });
  const reset = () =>
    void navigate({ search: {}, replace: true, resetScroll: false });
  const filtered = Object.values(filters).some(Boolean);
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Kegiatan lapangan
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Kunjungan
        </h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Tinjau kunjungan Outlet yang dilaporkan Sales Force melalui Dashboard
          Web dan Telegram Bot.
        </p>
      </div>
      <div>
        <OperationalRefresh />
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Aktivitas kunjungan</CardTitle>
            <Badge variant="secondary">
              {data.total.toLocaleString("id-ID")} kunjungan
            </Badge>
          </div>
          <CardDescription>Data operasional · Waktu dalam WIB</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="visit-search" className="sr-only">
                Cari kunjungan
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="visit-search"
                  placeholder="Cari Outlet, Sales Force, ID kunjungan, atau catatan…"
                  value={filters.q}
                  onChange={(event) => update("q", event.target.value)}
                />
                <InputGroupAddon>
                  <MagnifyingGlassIcon />
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {(
                [
                  {
                    key: "member",
                    title: "ID Sales Force",
                    page: data.members,
                  },
                  { key: "outlet", title: "ID Outlet", page: data.outlets },
                ] as const
              ).map(({ key, title, page }) => (
                <Field key={key}>
                  <FieldLabel htmlFor={key}>{title}</FieldLabel>
                  <Input
                    id={key}
                    list={`${key}-options`}
                    value={filters[key]}
                    onChange={(event) => update(key, event.target.value)}
                    placeholder="Semua"
                  />
                  <datalist id={`${key}-options`}>
                    {page.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </datalist>
                  <p className="text-muted-foreground text-xs">
                    Saran {page.items.length} dari {page.total}. ID lain dapat
                    diketik dari direktori.
                  </p>
                </Field>
              ))}
              <FilterSelect
                id="channel"
                label="Kanal pelaporan"
                value={filters.channel}
                onChange={(value) => update("channel", value)}
                options={[
                  { value: "web", label: "Dashboard Web" },
                  { value: "telegram", label: "Telegram Bot" },
                ]}
              />
              <FilterSelect
                id="stock"
                label="Laporan stok"
                value={filters.stock}
                onChange={(value) => update("stock", value)}
                options={[
                  { value: "with", label: "Dengan laporan stok" },
                  { value: "without", label: "Tanpa laporan stok" },
                ]}
              />
              <Field className="sm:col-span-2 xl:col-span-1">
                <FieldLabel htmlFor="date">Tanggal kunjungan (WIB)</FieldLabel>
                <Input
                  id="date"
                  type="date"
                  value={filters.date}
                  onChange={(event) => update("date", event.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
          <div className="flex min-h-8 items-center justify-between gap-2">
            <p role="status" className="text-muted-foreground text-xs">
              Menampilkan {results.length} dari {data.total} kunjungan · Terbaru
              dahulu
            </p>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={reset}>
                Hapus filter
              </Button>
            )}
          </div>
          {results.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MagnifyingGlassIcon />
                </EmptyMedia>
                <EmptyTitle>Tidak ada kunjungan yang sesuai</EmptyTitle>
                <EmptyDescription>
                  Coba kata kunci lain atau hapus filter untuk melihat semua
                  kunjungan.
                </EmptyDescription>
              </EmptyHeader>
              <Button variant="outline" onClick={reset}>
                Hapus filter
              </Button>
            </Empty>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Outlet / kunjungan</TableHead>
                      <TableHead>Sales Force</TableHead>
                      <TableHead>Waktu kunjungan</TableHead>
                      <TableHead>Kanal pelaporan</TableHead>
                      <TableHead>Laporan stok</TableHead>
                      <TableHead>
                        <span className="sr-only">Detail</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((visit) => {
                      const { outlet, member, reports } = visitContext(visit);
                      return (
                        <TableRow key={visit.id}>
                          <TableCell>
                            <Link
                              className="font-medium underline-offset-4 hover:underline"
                              to="/visits/$visitId"
                              params={{ visitId: visit.id }}
                              search={filters}
                            >
                              {outlet.name}
                            </Link>
                            <span className="text-muted-foreground mt-1 block text-xs">
                              {visit.id}
                            </span>
                          </TableCell>
                          <TableCell>{member.name}</TableCell>
                          <TableCell className="tabular-nums">
                            {formatTime(visit.visitedAt)}
                          </TableCell>
                          <TableCell>
                            <ChannelBadge channel={visit.submissionChannel} />
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={reports.length ? "secondary" : "outline"}
                            >
                              {reports.length
                                ? `${reports.length} laporan`
                                : "Tidak ada"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              nativeButton={false}
                              variant="ghost"
                              size="icon"
                              render={
                                <Link
                                  to="/visits/$visitId"
                                  params={{ visitId: visit.id }}
                                  search={filters}
                                  aria-label={`Lihat kunjungan ${visit.id}`}
                                />
                              }
                            >
                              <ArrowRightIcon />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-col gap-3 md:hidden">
                {results.map((visit) => {
                  const { outlet, member, reports } = visitContext(visit);
                  return (
                    <Link
                      key={visit.id}
                      to="/visits/$visitId"
                      params={{ visitId: visit.id }}
                      search={filters}
                      className="focus-visible:outline-ring flex flex-col gap-3 rounded-lg border p-4 focus-visible:outline-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{outlet.name}</span>
                        <ArrowRightIcon aria-hidden="true" />
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {visit.id} · {formatTime(visit.visitedAt)} WIB
                      </div>
                      <p className="text-sm">{member.name}</p>
                      <div className="flex flex-wrap gap-2">
                        <ChannelBadge channel={visit.submissionChannel} />
                        <Badge variant="secondary">
                          {reports.length} laporan stok
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
          <ReadPagination
            offset={Number(filters.offset || 0)}
            count={results.length}
            total={data.total}
            onChange={(offset) => update("offset", String(offset))}
          />
          <p className="text-muted-foreground flex items-start gap-2 text-xs">
            <ClipboardTextIcon className="size-4 shrink-0" />
            Laporan stok bersifat opsional dan mencatat jumlah pada waktu
            pelaporan, bukan stok terkini.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
