import type { StockReport } from "@sales-visit/contracts";

import { ChannelBadge } from "@/components/channel-badge";
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
import { products, salesForce } from "@/data/mock-data";
import { formatTime } from "@/lib/formatters";

export function StockReportCard({ report }: { report: StockReport }) {
  const reporter = salesForce.find(
    (member) => member.id === report.reporterSalesForceId
  )!;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{report.id}</CardTitle>
          <ChannelBadge channel={report.submissionChannel} />
        </div>
        <CardDescription>
          {formatTime(report.reportedAt)} WIB · Dilaporkan oleh {reporter.name}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead className="text-right">Jumlah dilaporkan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.items.map((item) => {
              const product = products.find(
                (entry) => entry.id === item.productId
              )!;
              return (
                <TableRow key={item.productId}>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{product.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {product.category}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.quantity}{" "}
                    <span className="text-muted-foreground">
                      {product.unit}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
