import { Button } from "@/components/ui/button";

export function ReadPagination({
  offset,
  count,
  total,
  onChange,
}: {
  offset: number;
  count: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  return (
    <nav
      aria-label="Halaman data"
      className="flex flex-wrap items-center gap-3"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - 25))}
      >
        Sebelumnya
      </Button>
      <p role="status" className="text-muted-foreground text-xs">
        {count ? offset + 1 : 0}–{offset + count} dari{" "}
        {total.toLocaleString("id-ID")}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={offset + count >= total || offset + 25 > 100000}
        onClick={() => onChange(offset + 25)}
      >
        Berikutnya
      </Button>
      {offset + 25 > 100000 && offset + count < total && (
        <p className="text-muted-foreground text-xs">
          Batas halaman tercapai. Persempit filter.
        </p>
      )}
    </nav>
  );
}
