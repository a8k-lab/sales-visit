import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { OverviewData } from "@/features/overview/lib/overview-data";

export function VisitActivity({ days }: { days: OverviewData["dailyVisits"] }) {
  const maximum = Math.max(1, ...days.map((day) => day.count));
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2>Kunjungan tercatat per tanggal</h2>
        </CardTitle>
        <CardDescription>
          14 hari hingga kunjungan terbaru · Waktu dalam WIB
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {days.length ? (
          <>
            <p className="text-muted-foreground text-xs">
              {days[0]?.label} – {days.at(-1)?.label}
            </p>
            <ol
              aria-label="Jumlah kunjungan tercatat per tanggal"
              className="grid grid-cols-14 gap-1 sm:gap-2"
            >
              {days.map((day) => (
                <li key={day.date} className="flex min-w-0 flex-col gap-2">
                  <span className="sr-only">
                    {day.label}: {day.count.toLocaleString("id-ID")} kunjungan
                  </span>
                  <div
                    aria-hidden="true"
                    className="flex h-44 flex-col justify-end gap-1"
                  >
                    <span className="text-center text-xs tabular-nums">
                      {day.count.toLocaleString("id-ID")}
                    </span>
                    <div
                      className="bg-primary mx-auto w-full max-w-8 rounded-t-sm"
                      style={{ height: `${(day.count / maximum) * 140}px` }}
                    />
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground border-t pt-2 text-center text-xs tabular-nums"
                  >
                    {day.day}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-muted-foreground text-xs">
              Tanggal (WIB) · Hari tanpa kunjungan bernilai 0.
            </p>
          </>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Belum ada kunjungan tercatat</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
