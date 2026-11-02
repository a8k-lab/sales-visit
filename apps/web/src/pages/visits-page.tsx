import {
  ArrowRightIcon,
  ClipboardTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { ChannelBadge, formatTime } from "@/components/report-display";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { outlets, salesForce, visitContext, visits } from "@/data/mock-data";
import { filterVisits, type VisitFilters } from "@/data/visits";

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const items = [
    { value: "", label: `All ${label.toLowerCase()}` },
    ...options,
  ];
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => onChange(next ?? "")}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

export function VisitsPage() {
  const filters = useSearch({ from: "/visits" });
  const navigate = useNavigate({ from: "/visits" });
  const results = filterVisits(filters);
  const update = (key: keyof VisitFilters, value: string) =>
    void navigate({
      search: (previous: VisitFilters) => ({ ...previous, [key]: value }),
      replace: true,
      resetScroll: false,
    });
  const reset = () =>
    void navigate({ search: {}, replace: true, resetScroll: false });
  const filtered = Object.values(filters).some(Boolean);
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Field operations
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Visits
        </h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Review outlet visits from your Sales Force, reported through Web and
          Telegram.
        </p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Visit activity</CardTitle>
            <Badge variant="secondary">{visits.length} visits</Badge>
          </div>
          <CardDescription>
            Synthetic records · 30 Oct–3 Nov 2026 · Times in WIB (UTC+7)
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="visit-search" className="sr-only">
                Search visits
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="visit-search"
                  placeholder="Search outlet, Sales Force, visit ID, or notes…"
                  value={filters.q}
                  onChange={(event) => update("q", event.target.value)}
                />
                <InputGroupAddon>
                  <MagnifyingGlassIcon />
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <FilterSelect
                id="member"
                label="Sales Force"
                value={filters.member}
                onChange={(value) => update("member", value)}
                options={salesForce.map((member) => ({
                  value: member.id,
                  label: member.name,
                }))}
              />
              <FilterSelect
                id="outlet"
                label="Outlets"
                value={filters.outlet}
                onChange={(value) => update("outlet", value)}
                options={outlets.map((outlet) => ({
                  value: outlet.id,
                  label: outlet.name,
                }))}
              />
              <FilterSelect
                id="channel"
                label="Channels"
                value={filters.channel}
                onChange={(value) => update("channel", value)}
                options={[
                  { value: "web", label: "Web Dashboard" },
                  { value: "telegram", label: "Telegram Bot" },
                ]}
              />
              <FilterSelect
                id="stock"
                label="Stock reports"
                value={filters.stock}
                onChange={(value) => update("stock", value)}
                options={[
                  { value: "with", label: "With stock reports" },
                  { value: "without", label: "Without stock reports" },
                ]}
              />
              <Field className="sm:col-span-2 xl:col-span-1">
                <FieldLabel htmlFor="date">Visit date (WIB)</FieldLabel>
                <Input
                  id="date"
                  type="date"
                  value={filters.date}
                  onChange={(event) => update("date", event.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
          <div className="flex min-h-8 items-center justify-between gap-2">
            <p role="status" className="text-muted-foreground text-xs">
              Showing {results.length} of {visits.length} visits · Newest first
            </p>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={reset}>
                Clear filters
              </Button>
            )}
          </div>
          {results.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MagnifyingGlassIcon />
                </EmptyMedia>
                <EmptyTitle>No matching visits</EmptyTitle>
                <EmptyDescription>
                  Try another search or clear the filters to see all visits.
                </EmptyDescription>
              </EmptyHeader>
              <Button variant="outline" onClick={reset}>
                Clear filters
              </Button>
            </Empty>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Outlet / visit</TableHead>
                      <TableHead>Sales Force</TableHead>
                      <TableHead>Visited at</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Stock reports</TableHead>
                      <TableHead>
                        <span className="sr-only">Details</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((visit) => {
                      const { outlet, member, reports } = visitContext(visit);
                      return (
                        <TableRow key={visit.id}>
                          <TableCell>
                            <Link
                              className="font-medium underline-offset-4 hover:underline"
                              to="/visits/$visitId"
                              params={{ visitId: visit.id }}
                              search={filters}
                            >
                              {outlet.name}
                            </Link>
                            <span className="text-muted-foreground mt-1 block text-xs">
                              {visit.id}
                            </span>
                          </TableCell>
                          <TableCell>{member.name}</TableCell>
                          <TableCell className="tabular-nums">
                            {formatTime(visit.visitedAt)}
                          </TableCell>
                          <TableCell>
                            <ChannelBadge channel={visit.submissionChannel} />
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={reports.length ? "secondary" : "outline"}
                            >
                              {reports.length
                                ? `${reports.length} linked`
                                : "None"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              nativeButton={false}
                              variant="ghost"
                              size="icon"
                              render={
                                <Link
                                  to="/visits/$visitId"
                                  params={{ visitId: visit.id }}
                                  search={filters}
                                  aria-label={`View ${visit.id}`}
                                />
                              }
                            >
                              <ArrowRightIcon />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-col gap-3 md:hidden">
                {results.map((visit) => {
                  const { outlet, member, reports } = visitContext(visit);
                  return (
                    <Link
                      key={visit.id}
                      to="/visits/$visitId"
                      params={{ visitId: visit.id }}
                      search={filters}
                      className="focus-visible:outline-ring flex flex-col gap-3 rounded-lg border p-4 focus-visible:outline-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{outlet.name}</span>
                        <ArrowRightIcon aria-hidden="true" />
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {visit.id} · {formatTime(visit.visitedAt)} WIB
                      </div>
                      <p className="text-sm">{member.name}</p>
                      <div className="flex flex-wrap gap-2">
                        <ChannelBadge channel={visit.submissionChannel} />
                        <Badge variant="secondary">
                          {reports.length} stock reports
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
          <p className="text-muted-foreground flex items-start gap-2 text-xs">
            <ClipboardTextIcon className="size-4 shrink-0" />A visit records
            field activity. Stock reports are separate, optional snapshots—not
            live inventory.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
