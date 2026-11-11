import {
  Link,
  useLoaderData,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";

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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccount } from "@/features/auth/session";
import { StockReportCard } from "@/features/stock-reports/components/stock-report-card";

export function DirectoryPage() {
  const account = useAccount();
  const data = useLoaderData({ from: "/dashboard/directory" });
  const search = useSearch({ from: "/dashboard/directory" });
  const navigate = useNavigate({ from: "/directory" });
  const page = data.references ?? data.records;
  const title = {
    "sales-force": "Sales Force",
    products: "Produk",
    "stock-reports": "Laporan stok",
  }[search.kind];
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Data referensi
        </h1>
        <p className="text-muted-foreground text-sm">
          Master data dan laporan operasional sesuai akses Anda.
        </p>
      </div>
      <nav aria-label="Jenis referensi" className="flex flex-wrap gap-2">
        {(["sales-force", "products", "stock-reports"] as const).map((kind) => (
          <Button
            key={kind}
            nativeButton={false}
            variant={search.kind === kind ? "secondary" : "outline"}
            render={
              <Link
                to="/directory"
                search={{ kind }}
                aria-current={search.kind === kind ? "page" : undefined}
              />
            }
          >
            {
              {
                "sales-force": "Sales Force",
                products: "Produk",
                "stock-reports": "Laporan stok",
              }[kind]
            }
          </Button>
        ))}
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link to="/outlets" search={{}} />}
        >
          Outlet
        </Button>
        {account?.role === "admin" && search.kind === "sales-force" && (
          <Button
            nativeButton={false}
            variant="outline"
            render={
              <Link to="/master/sales-force" search={{ q: "", after: "" }} />
            }
          >
            Kelola Sales Force
          </Button>
        )}
        <OperationalRefresh />
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {search.kind === "stock-reports"
              ? "Terbaru dahulu, termasuk laporan tanpa kunjungan. Bukan stok terkini."
              : "Nama dan ID dari master data."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {data.references && (
            <Field>
              <FieldLabel htmlFor="directory-search">
                Cari nama atau ID
              </FieldLabel>
              <Input
                id="directory-search"
                value={search.q}
                maxLength={200}
                onChange={(e) =>
                  void navigate({
                    search: { ...search, q: e.target.value, offset: 0 },
                    replace: true,
                    resetScroll: false,
                  })
                }
              />
            </Field>
          )}
          {!page.items.length && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Belum ada data yang sesuai</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          {data.references && data.references.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.references.items.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="whitespace-normal">
                      {record.name}
                    </TableCell>
                    <TableCell className="break-all whitespace-normal">
                      {record.id}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {data.records?.items.map((report) => (
            <div key={report.id} className="flex flex-col gap-2">
              <Link
                to="/outlets/$outletId"
                params={{ outletId: report.outletId }}
                search={{}}
                className="text-sm break-all underline underline-offset-4"
              >
                Outlet · {report.outletId}
              </Link>
              <StockReportCard report={report} />
            </div>
          ))}
          <ReadPagination
            offset={search.offset}
            count={page.items.length}
            total={page.total}
            onChange={(offset) =>
              void navigate({
                search: { ...search, offset },
                resetScroll: false,
              })
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
