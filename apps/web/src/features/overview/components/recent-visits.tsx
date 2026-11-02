import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { ChannelBadge } from "@/components/channel-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { OverviewData } from "@/features/overview/lib/overview-data";
import { formatTime } from "@/lib/formatters";

export function RecentVisits({
  visits,
}: {
  visits: OverviewData["recentVisits"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Kunjungan terbaru</h2>
        </CardTitle>
        <CardDescription>
          Lima kunjungan terakhir berdasarkan waktu kunjungan · WIB
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {visits.length ? (
          <ul className="divide-y">
            {visits.map((visit) => (
              <li
                key={visit.id}
                className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    to="/visits/$visitId"
                    params={{ visitId: visit.id }}
                    search={{}}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {visit.outlet.name}
                    <span className="sr-only"> · Kunjungan {visit.id}</span>
                  </Link>
                  <span className="text-muted-foreground text-xs">
                    Sales Force · {visit.member.name}
                  </span>
                </div>
                <div className="flex flex-col gap-1 text-xs">
                  <time dateTime={visit.visitedAt}>
                    {formatTime(visit.visitedAt)} WIB
                  </time>
                  {visit.submittedAt && (
                    <span className="text-muted-foreground">
                      Tersimpan di browser ini
                    </span>
                  )}
                </div>
                <div>
                  <ChannelBadge channel={visit.submissionChannel} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Belum ada kunjungan tercatat</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
        <Button
          nativeButton={false}
          variant="outline"
          className="self-start"
          render={<Link to="/visits" search={{}} />}
        >
          Lihat semua kunjungan
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </CardContent>
    </Card>
  );
}
