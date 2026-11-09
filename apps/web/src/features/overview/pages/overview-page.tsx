import {
  ClipboardTextIcon,
  NotebookIcon,
  StorefrontIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { Link, useLoaderData } from "@tanstack/react-router";

import { ChannelBadge } from "@/components/channel-badge";
import { OperationalRefresh } from "@/components/operational-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RecentVisits } from "@/features/overview/components/recent-visits";
import { VisitActivity } from "@/features/overview/components/visit-activity";

const percentage = new Intl.NumberFormat("id-ID", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function OverviewPage() {
  const data = useLoaderData({ from: "/dashboard/overview" });
  const metrics = [
    {
      title: "Total Kunjungan",
      count: data.metrics.visits,
      icon: ClipboardTextIcon,
      description: "Kunjungan dalam periode pelaporan",
    },
    {
      title: "Outlet Dikunjungi",
      count: data.metrics.outlets,
      icon: StorefrontIcon,
      description: "Outlet unik dalam catatan kunjungan",
    },
    {
      title: "Sales Force yang Berkunjung",
      count: data.metrics.salesForce,
      icon: UsersIcon,
      description: "Petugas unik dalam catatan kunjungan",
    },
    {
      title: "Laporan Stok",
      count: data.metrics.stockReports,
      icon: NotebookIcon,
      description: "Termasuk laporan tanpa kunjungan",
    },
  ];
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Kegiatan lapangan
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Ringkasan
        </h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Aktivitas operasional sesuai akses Anda · 14 hari kalender hingga hari
          ini (WIB).
        </p>
      </div>
      <nav aria-label="Aksi cepat" className="flex flex-wrap gap-2">
        <OperationalRefresh />
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link to="/visits" search={{}} />}
        >
          Lihat Kunjungan
        </Button>
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link to="/outlets" search={{}} />}
        >
          Lihat Outlet
        </Button>
      </nav>
      <section
        aria-label="Ringkasan periode pelaporan"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {metrics.map(({ title, count, icon: Icon, description }) => (
          <Card key={title}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle>
                  <h2>{title}</h2>
                </CardTitle>
                <Icon
                  aria-hidden="true"
                  className="text-muted-foreground size-5 shrink-0"
                />
              </div>
            </CardHeader>
            <CardContent className="mt-auto flex flex-col gap-2">
              <p className="text-3xl font-semibold tracking-tight tabular-nums">
                {count.toLocaleString("id-ID")}
              </p>
              <p className="text-muted-foreground text-xs">{description}</p>
            </CardContent>
          </Card>
        ))}
      </section>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <VisitActivity days={data.dailyVisits} />
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Kanal pelaporan kunjungan</h2>
            </CardTitle>
            <CardDescription>
              Jumlah kunjungan menurut kanal pengiriman.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-6">
              {data.channels.map(({ channel, count, percentage: share }) => (
                <li key={channel} className="flex flex-col gap-3">
                  <div>
                    <ChannelBadge channel={channel} />
                  </div>
                  <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm tabular-nums">
                    <span>{count.toLocaleString("id-ID")} kunjungan</span>
                    <span className="text-muted-foreground">
                      {percentage.format(share)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <RecentVisits visits={data.recentVisits} />
    </>
  );
}
