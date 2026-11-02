import { Link } from "@tanstack/react-router";

import { StockReportCard } from "@/components/report-display";
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

export function DirectoryPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Workspace records
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Reference data
        </h1>
        <p className="text-muted-foreground text-sm">
          Read-only synthetic records shared across this prototype. No accounts
          or master-data editing are connected.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            Sales Force <Badge variant="secondary">{salesForce.length}</Badge>
          </CardTitle>
          <CardDescription>
            Field staff can use both Web Dashboard and Telegram Bot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Territory</TableHead>
                <TableHead>Contact (synthetic)</TableHead>
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
            Outlets <Badge variant="secondary">{outlets.length}</Badge>
          </CardTitle>
          <CardDescription>
            Business records, not outlet user accounts. Outlet self-reporting is
            deferred.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Outlet</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Contact</TableHead>
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
            Products <Badge variant="secondary">{products.length}</Badge>
          </CardTitle>
          <CardDescription>
            Catalog definitions, separate from reported outlet quantities.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Unit</TableHead>
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
            Stock report register{" "}
            <Badge variant="secondary">{stockReports.length}</Badge>
          </h2>
          <p className="text-muted-foreground text-sm">
            Includes standalone snapshots reported by Sales Force. A stock
            report is not evidence of a visit.
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
                "No linked visit"
              )}
            </p>
            <StockReportCard report={report} />
          </div>
        ))}
      </section>
    </>
  );
}
