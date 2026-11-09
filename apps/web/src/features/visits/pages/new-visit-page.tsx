import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

// The localStorage prototype is intentionally not an operational write path.
// Keep reusable entry fields and validation for the D1-backed Web milestone.
export function NewVisitPage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Pelaporan Web belum tersedia</EmptyTitle>
        <EmptyDescription>
          Gunakan Telegram Bot untuk melaporkan kunjungan. Pelaporan Web akan
          tersedia pada tahap berikutnya.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
