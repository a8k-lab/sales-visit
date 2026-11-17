import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export function OperationalPending() {
  return (
    <p role="status" className="text-muted-foreground p-6">
      Memuat data operasional…
    </p>
  );
}
export function OperationalError() {
  const router = useRouter();
  return (
    <Empty>
      <EmptyHeader role="alert">
        <EmptyTitle>Data belum dapat dimuat</EmptyTitle>
        <EmptyDescription>
          Periksa koneksi dan sesi Anda, lalu coba lagi. Tidak ada data contoh
          yang ditampilkan.
        </EmptyDescription>
      </EmptyHeader>
      <Button onClick={() => void router.invalidate()}>Coba lagi</Button>
    </Empty>
  );
}
export function OperationalRefresh() {
  const router = useRouter();
  const routeBusy = useRouterState({ select: (state) => state.isLoading });
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const busy = refreshing || routeBusy;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      aria-label={busy ? "Memperbarui data" : "Perbarui data"}
      aria-busy={busy}
      onClick={() => {
        if (inFlight.current) return;
        inFlight.current = true;
        setRefreshing(true);
        void router.invalidate().finally(() => {
          inFlight.current = false;
          setRefreshing(false);
        });
      }}
    >
      <ArrowClockwiseIcon data-icon="inline-start" aria-hidden="true" />
      Perbarui data
    </Button>
  );
}
