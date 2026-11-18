import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
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
  useEffect(() => {
    setSelected(row.supervisorUserId ?? "");
  }, [row.supervisorUserId]);
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
        <Dialog
          open={confirming}
          onOpenChange={(open) => {
            if (!busy) setConfirming(open);
          }}
        >
          <DialogTrigger
            render={<Button variant="outline" disabled={busy || !changed} />}
          >
            Simpan
          </DialogTrigger>
          <DialogContent showCloseButton={!busy}>
            <DialogHeader>
              <DialogTitle>Konfirmasi penugasan</DialogTitle>
              <DialogDescription>
                Akses pemantauan seluruh riwayat aktivitas berubah segera
                setelah penugasan disimpan.
              </DialogDescription>
            </DialogHeader>
            <dl className="grid gap-2 break-words">
              <div>
                <dt className="text-muted-foreground">Sales Force</dt>
                <dd>{row.salesForceName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Supervisor saat ini</dt>
                <dd>
                  {row.supervisorName ??
                    row.supervisorUserId ??
                    "Tanpa Supervisor"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Supervisor baru</dt>
                <dd>
                  {options.find((option) => option.value === selected)?.label}
                </dd>
              </div>
            </dl>
            <DialogFooter>
              <DialogClose
                render={<Button variant="outline" disabled={busy} />}
                autoFocus
              >
                Batal
              </DialogClose>
              <Button
                disabled={busy || !changed}
                onClick={() => {
                  void onSave(row, selected || null).finally(() =>
                    setConfirming(false)
                  );
                }}
              >
                {busy ? "Menyimpan…" : "Ya, simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
  const [needsReload, setNeedsReload] = useState(false);
  const saving = useRef(false);
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
          setNeedsReload(false);
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
    if (
      saving.current ||
      needsReload ||
      supervisorUserId === row.supervisorUserId
    )
      return;
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await api<Assignment>("/supervisor-assignments", {
        method: "PUT",
        body: JSON.stringify({
          salesForceId: row.salesForceId,
          supervisorUserId,
        }),
      });
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
    } catch {
      setNeedsReload(true);
      setError(
        "Hasil penyimpanan belum dapat dipastikan. Muat ulang untuk memeriksa penugasan sebelum melakukan perubahan lagi."
      );
    } finally {
      saving.current = false;
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
                  <EmptyDescription>
                    Tambahkan master Sales Force sebelum mengatur penugasan.
                  </EmptyDescription>
                </EmptyHeader>
                <Button
                  nativeButton={false}
                  variant="outline"
                  render={
                    <Link
                      to="/master/sales-force"
                      search={{ q: "", after: "" }}
                    />
                  }
                >
                  Kelola Sales Force
                </Button>
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
                      key={`${revision}:${row.salesForceId}`}
                      row={row}
                      supervisors={supervisors}
                      busy={busy || needsReload}
                      onSave={save}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
            {!supervisors.length && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Belum ada Supervisor aktif</EmptyTitle>
                  <EmptyDescription>
                    Minta anggota tim mendaftar melalui Telegram, lalu setujui
                    akun dengan peran Supervisor di Pengguna & Akses. Penugasan
                    yang ada tetap dapat dihapus.
                  </EmptyDescription>
                </EmptyHeader>
                <Button
                  nativeButton={false}
                  variant="outline"
                  render={
                    <Link
                      to="/users"
                      search={{ after: "", pendingAfter: "", status: "" }}
                    />
                  }
                >
                  Pengguna & Akses
                </Button>
              </Empty>
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
