import {
  ArrowLeftIcon,
  ClipboardTextIcon,
  MapPinIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { Link, useLoaderData, useSearch } from "@tanstack/react-router";

import {
  ChannelBadge,
  formatTime,
  StockReportCard,
} from "@/components/report-display";
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
import { visitContext } from "@/data/mock-data";

export function VisitDetailPage() {
  const visit = useLoaderData({ from: "/visits/$visitId" });
  const filters = useSearch({ from: "/visits/$visitId" });
  const { outlet, member, reports } = visitContext(visit);
  return (
    <>
      <div>
        <Button
          nativeButton={false}
          variant="ghost"
          size="sm"
          render={<Link to="/visits" search={filters} />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Back to visits
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Visit details · {visit.id}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {outlet.name}
        </h1>
        <p className="text-muted-foreground text-sm">
          Visited by {member.name} · {formatTime(visit.visitedAt)} WIB
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPinIcon className="size-4" />
              Outlet information
            </CardTitle>
            <CardDescription>
              {outlet.id} · Synthetic business record
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Outlet</dt>
                <dd className="mt-1 font-medium">{outlet.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Address</dt>
                <dd className="mt-1">{outlet.address}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Contact</dt>
                <dd className="mt-1">
                  {outlet.contact} · {outlet.phone}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="size-4" />
              Sales Force & visit metadata
            </CardTitle>
            <CardDescription>
              Submission channel is independent of reporter identity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Sales Force</dt>
                <dd className="mt-1 font-medium">{member.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Territory</dt>
                <dd className="mt-1">{member.territory}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">
                  Staff reference
                </dt>
                <dd className="mt-1">{member.id}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Channel</dt>
                <dd className="mt-1">
                  <ChannelBadge channel={visit.submissionChannel} />
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground text-xs">
                  Visited at (WIB / UTC+7)
                </dt>
                <dd className="mt-1 tabular-nums">
                  {formatTime(visit.visitedAt)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Visit outcome</CardTitle>
          <CardDescription>
            Notes and follow-up recorded for this visit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-5 text-sm">
            <div>
              <dt className="text-muted-foreground mb-2 text-xs font-medium">
                Notes
              </dt>
              <dd className="leading-relaxed">
                {visit.notes || "No notes recorded."}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground mb-2 text-xs font-medium">
                Follow-up
              </dt>
              <dd className="leading-relaxed">
                {visit.followUp || "No follow-up recorded."}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <section aria-labelledby="stock-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2
              id="stock-heading"
              className="text-lg font-semibold tracking-tight"
            >
              Associated stock reports
            </h2>
            <Badge variant="secondary">{reports.length}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Reported quantities at a point in time, not live inventory. Multiple
            reports can belong to one visit.
          </p>
        </div>
        {reports.length ? (
          reports.map((report) => (
            <StockReportCard key={report.id} report={report} />
          ))
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardTextIcon />
              </EmptyMedia>
              <EmptyTitle>No stock reports for this visit</EmptyTitle>
              <EmptyDescription>
                This visit was recorded without a stock report. A visit does not
                require stock quantities.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </>
  );
}
