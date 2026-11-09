import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, useAccount } from "@/features/auth/session";

type Supervisor = { id: string; name: string };
type Assignment = {
  salesForceId: string;
  salesForceName: string;
  supervisorUserId: string | null;
  supervisorName: string | null;
  supervisorStatus: string | null;
  supervisorRole: string | null;
};
type Page<T> = { items: T[]; next: string | null };

async function supervisorOptions() {
  const items: Supervisor[] = [];
  let after: string | null = "";
  while (after !== null) {
    const page: Page<Supervisor> = await api(
      `/supervisors?after=${encodeURIComponent(after)}`
    );
    items.push(...page.items);
    after = page.next;
  }
  return items;
}

function AssignmentRow({
  row,
  supervisors,
  busy,
  onSave,
}: {
  row: Assignment;
  supervisors: Supervisor[];
  busy: boolean;
  onSave: (row: Assignment, supervisorUserId: string | null) => Promise<void>;
}) {
  const [selected, setSelected] = useState(row.supervisorUserId ?? "");
  const [confirming, setConfirming] = useState(false);
  const changed = selected !== (row.supervisorUserId ?? "");
  const options = [
    { value: "", label: "Tanpa Supervisor" },
    ...supervisors.map((s) => ({ value: s.id, label: `${s.name} (${s.id})` })),
  ];
  if (
    row.supervisorUserId &&
    !supervisors.some((s) => s.id === row.supervisorUserId)
  ) {
    options.push({
      value: row.supervisorUserId,
      label: `${row.supervisorName ?? row.supervisorUserId} (tidak tersedia)`,
    });
  }
  return (
    <TableRow>
      <TableCell>
        <p>{row.salesForceName}</p>
        <p className="text-muted-foreground text-xs">{row.salesForceId}</p>
      </TableCell>
      <TableCell>
        {row.supervisorName ?? "Belum ditugaskan"}
        {row.supervisorUserId &&
          (row.supervisorRole !== "supervisor" ||
            row.supervisorStatus !== "active") && (
            <p className="text-muted-foreground text-xs">
              Tidak memiliki akses pemantauan
            </p>
          )}
      </TableCell>
      <TableCell>
        <Select
          items={options}
          value={selected}
          disabled={busy || confirming}
          onValueChange={(value) => setSelected(value ?? "")}
        >
          <SelectTrigger aria-label={`Supervisor untuk ${row.salesForceName}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={
                    option.value !== "" &&
                    !supervisors.some((s) => s.id === option.value)
                  }
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {confirming ? (
          <div className="flex flex-col gap-2">
            <p>
              Ubah penugasan {row.salesForceName} ke{" "}
              {options.find((o) => o.value === selected)?.label}? Akses riwayat
              langsung berubah.
            </p>
            <div className="flex gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  void onSave(row, selected || null).finally(() =>
                    setConfirming(false)
                  );
                }}
              >
                Ya, simpan
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Batal
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            disabled={busy || !changed}
            onClick={() => setConfirming(true)}
          >
            Simpan
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

export function AssignmentsPage() {
  const account = useAccount();
  const [after, setAfter] = useState("");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Page<Assignment> | null>(null);
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (account?.role !== "admin") return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.all([
      api<Page<Assignment>>(
        `/supervisor-assignments?limit=50&after=${encodeURIComponent(after)}`
      ),
      supervisorOptions(),
    ])
      .then(([page, options]) => {
        if (!cancelled) {
          setData(page);
          setSupervisors(options);
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled)
          setError(
            failure instanceof Error
              ? failure.message
              : "Gagal memuat penugasan."
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.role, after, revision]);
  if (account?.role !== "admin")
    return (
      <p role="alert">Akses tidak diizinkan. Halaman ini hanya untuk Admin.</p>
    );
  const save = async (row: Assignment, supervisorUserId: string | null) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await api<Assignment>(
        `/sales-force/${encodeURIComponent(row.salesForceId)}/supervisor`,
        { method: "PUT", body: JSON.stringify({ supervisorUserId }) }
      );
      setData(
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) =>
              item.salesForceId === updated.salesForceId ? updated : item
            ),
          }
      );
      setMessage(`Penugasan ${row.salesForceName} berhasil disimpan.`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Gagal menyimpan penugasan. Muat ulang sebelum mencoba lagi."
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-col gap-4" aria-labelledby="assignment-title">
      <h1 id="assignment-title" className="text-2xl font-semibold">
        Penugasan Supervisor
      </h1>
      <p className="text-muted-foreground text-sm">
        Kelola akses pemantauan Sales Force. Penugasan berlaku untuk seluruh
        riwayat aktivitas.
      </p>
      {error && <p role="alert">{error}</p>}
      <p role="status" aria-live="polite">
        {busy ? "Menyimpan penugasan…" : message}
      </p>
      <Button
        variant="outline"
        disabled={busy || loading}
        onClick={() => setRevision((value) => value + 1)}
      >
        Muat ulang
      </Button>
      {loading ? (
        <div role="status" className="flex flex-col gap-2">
          <p>Memuat penugasan…</p>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        !error &&
        data && (
          <>
            {!data.items.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Belum ada Sales Force</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sales Force</TableHead>
                    <TableHead>Supervisor saat ini</TableHead>
                    <TableHead>Penugasan baru</TableHead>
                    <TableHead>Tindakan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((row) => (
                    <AssignmentRow
                      key={`${revision}:${row.salesForceId}:${row.supervisorUserId}`}
                      row={row}
                      supervisors={supervisors}
                      busy={busy}
                      onSave={save}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
            {!supervisors.length && (
              <p>
                Tidak ada Supervisor aktif. Penugasan yang ada tetap dapat
                dihapus.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={busy || !after}
                onClick={() => {
                  setMessage("");
                  setAfter("");
                }}
              >
                Halaman pertama
              </Button>
              <Button
                variant="outline"
                disabled={busy || !data.next}
                onClick={() => {
                  setMessage("");
                  setAfter(data.next!);
                }}
              >
                Berikutnya
              </Button>
            </div>
          </>
        )
      )}
    </section>
  );
}
