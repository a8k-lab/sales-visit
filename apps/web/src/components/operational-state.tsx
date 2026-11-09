import { useRouter, useRouterState } from "@tanstack/react-router";

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
  const busy = useRouterState({ select: (state) => state.isLoading });
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() => void router.invalidate()}
    >
      {busy ? "Memperbarui…" : "Perbarui data"}
    </Button>
  );
}
