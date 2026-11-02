import { MagnifyingGlassIcon, StorefrontIcon } from "@phosphor-icons/react";
import {
  Link,
  useLoaderData,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";

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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
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
import { searchOutlets } from "@/features/outlets/lib/outlet-data";
import { formatTime } from "@/lib/formatters";

export function OutletsPage() {
  const data = useLoaderData({ from: "/dashboard/outlets" });
  const { q } = useSearch({ from: "/dashboard/outlets" });
  const navigate = useNavigate({ from: "/outlets" });
  const results = searchOutlets(data.outlets, q);
  const updateSearch = (value: string) =>
    void navigate({ search: { q: value }, replace: true, resetScroll: false });
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Data Outlet
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Outlet
        </h1>
        <p className="text-muted-foreground text-sm">
          Temukan informasi Outlet, riwayat kunjungan, dan laporan stok.
        </p>
      </div>
      {data.storageError && <FieldError>{data.storageError}</FieldError>}
      <Card>
        <CardHeader>
          <CardTitle>
            Daftar Outlet{" "}
            <Badge variant="secondary">{data.outlets.length}</Badge>
          </CardTitle>
          <CardDescription>
            Aktivitas berdasarkan kunjungan tercatat · Waktu dalam WIB
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="outlet-search" className="sr-only">
              Cari Outlet
            </FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="outlet-search"
                placeholder="Cari nama, alamat, atau kontak Outlet…"
                value={q}
                onChange={(event) => updateSearch(event.target.value)}
              />
              <InputGroupAddon>
                <MagnifyingGlassIcon />
              </InputGroupAddon>
            </InputGroup>
          </Field>
          <p role="status" className="text-muted-foreground text-xs">
            Menampilkan {results.length} dari {data.outlets.length} Outlet
          </p>
          {!results.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <StorefrontIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {q ? "Tidak ada Outlet yang sesuai" : "Belum ada Outlet"}
                </EmptyTitle>
                <EmptyDescription>
                  {q
                    ? "Coba nama, alamat, atau kontak lain."
                    : "Data Outlet belum tersedia."}
                </EmptyDescription>
              </EmptyHeader>
              {q && (
                <Button variant="outline" onClick={() => updateSearch("")}>
                  Hapus pencarian
                </Button>
              )}
            </Empty>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Outlet</TableHead>
                      <TableHead>Alamat</TableHead>
                      <TableHead>Kontak</TableHead>
                      <TableHead>Kunjungan tercatat</TableHead>
                      <TableHead>Kunjungan terakhir (WIB)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((outlet) => (
                      <TableRow key={outlet.id}>
                        <TableCell>
                          <Link
                            to="/outlets/$outletId"
                            params={{ outletId: outlet.id }}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {outlet.name}
                          </Link>
                          <span className="text-muted-foreground mt-1 block text-xs">
                            {outlet.id}
                          </span>
                        </TableCell>
                        <TableCell className="min-w-44 whitespace-normal">
                          {outlet.address}
                        </TableCell>
                        <TableCell>
                          {outlet.contact}
                          <span className="text-muted-foreground block text-xs">
                            {outlet.phone}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {outlet.visitCount}
                        </TableCell>
                        <TableCell>
                          {outlet.lastVisitedAt
                            ? formatTime(outlet.lastVisitedAt)
                            : "Belum ada kunjungan"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-col gap-3 md:hidden">
                {results.map((outlet) => (
                  <Link
                    key={outlet.id}
                    to="/outlets/$outletId"
                    params={{ outletId: outlet.id }}
                    className="focus-visible:outline-ring flex flex-col gap-2 rounded-lg border p-4 text-sm focus-visible:outline-2"
                  >
                    <span className="font-medium">{outlet.name}</span>
                    <span className="text-muted-foreground">
                      {outlet.address}
                    </span>
                    <span>
                      {outlet.contact} · {outlet.phone}
                    </span>
                    <span>{outlet.visitCount} kunjungan tercatat</span>
                    <span className="text-muted-foreground text-xs">
                      Terakhir:{" "}
                      {outlet.lastVisitedAt
                        ? `${formatTime(outlet.lastVisitedAt)} WIB`
                        : "Belum ada kunjungan"}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
