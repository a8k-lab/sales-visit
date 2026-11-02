import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { outlets, products, salesForce, stockReports } from "@/data/mock-data";
import { StockReportCard } from "@/features/stock-reports/components/stock-report-card";

export function DirectoryPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Data ruang kerja
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Data referensi
        </h1>
        <p className="text-muted-foreground text-sm">
          Lihat data Sales Force, Outlet, produk, dan laporan stok.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            Sales Force <Badge variant="secondary">{salesForce.length}</Badge>
          </CardTitle>
          <CardDescription>
            Sales Force dapat melapor melalui Dashboard Web atau Telegram Bot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Wilayah</TableHead>
                <TableHead>Kontak</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {salesForce.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>{member.name}</TableCell>
                  <TableCell>{member.territory}</TableCell>
                  <TableCell>{member.phone}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            Outlet <Badge variant="secondary">{outlets.length}</Badge>
          </CardTitle>
          <CardDescription>
            Pilih Outlet untuk melihat riwayat kunjungannya.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Outlet</TableHead>
                <TableHead>Alamat</TableHead>
                <TableHead>Kontak</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outlets.map((outlet) => (
                <TableRow key={outlet.id}>
                  <TableCell>
                    <Link
                      to="/visits"
                      search={{ outlet: outlet.id }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {outlet.name}
                    </Link>
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal">
                    {outlet.address}
                  </TableCell>
                  <TableCell>{outlet.contact}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            Produk <Badge variant="secondary">{products.length}</Badge>
          </CardTitle>
          <CardDescription>
            Daftar produk dan satuan pelaporannya.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Satuan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="whitespace-normal">
                    {product.name}
                  </TableCell>
                  <TableCell>{product.category}</TableCell>
                  <TableCell>{product.unit}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <section className="flex flex-col gap-4" aria-labelledby="reports-title">
        <div className="flex flex-col gap-2">
          <h2 id="reports-title" className="text-lg font-semibold">
            Daftar laporan stok{" "}
            <Badge variant="secondary">{stockReports.length}</Badge>
          </h2>
          <p className="text-muted-foreground text-sm">
            Laporan stok dari Sales Force, dengan atau tanpa kunjungan terkait.
          </p>
        </div>
        {stockReports.map((report) => (
          <div key={report.id} className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              {outlets.find((outlet) => outlet.id === report.outletId)!.name} ·{" "}
              {report.visitId ? (
                <Link
                  to="/visits/$visitId"
                  params={{ visitId: report.visitId }}
                  search={{}}
                  className="underline underline-offset-4"
                >
                  {report.visitId}
                </Link>
              ) : (
                "Tanpa kunjungan terkait"
              )}
            </p>
            <StockReportCard report={report} />
          </div>
        ))}
      </section>
    </>
  );
}
