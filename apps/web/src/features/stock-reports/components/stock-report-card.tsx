import type { NamedStockReport } from "@sales-visit/contracts";

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
import { formatTime } from "@/lib/formatters";

export function StockReportCard({ report }: { report: NamedStockReport }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{report.id}</CardTitle>
          <ChannelBadge channel={report.submissionChannel} />
        </div>
        <CardDescription>
          {formatTime(report.reportedAt)} WIB · Dilaporkan oleh{" "}
          {report.reporter?.name ?? report.reporterSalesForceId}
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
              const product = item.product;
              return (
                <TableRow key={item.productId}>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">
                      {product?.name ?? item.productId}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {item.productId}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.quantity.toLocaleString("id-ID")}
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
