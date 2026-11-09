import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export function WorkspacePage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Ruang kerja Sales Force</EmptyTitle>
        <EmptyDescription>
          Pelaporan kunjungan saat ini tersedia melalui Telegram Bot. Ruang
          kerja dan pelaporan Web sedang disiapkan untuk tahap berikutnya.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
