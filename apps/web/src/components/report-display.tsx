import { BrowserIcon, TelegramLogoIcon } from "@phosphor-icons/react";
import type { StockReport, SubmissionChannel } from "@sales-visit/contracts";

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
import { products, salesForce } from "@/data/mock-data";

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function ChannelBadge({ channel }: { channel: SubmissionChannel }) {
  return (
    <Badge variant="outline">
      {channel === "web" ? <BrowserIcon /> : <TelegramLogoIcon />}
      {channel === "web" ? "Dashboard Web" : "Telegram Bot"}
    </Badge>
  );
}

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
