import { TrashIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import type { ManagedOutlet } from "../lib/outlet-data";
import { OutletOutcome, useOutletMutation } from "./mutation";
const labels: Record<string, string> = {
  visit: "kunjungan",
  stock_report: "laporan stok (termasuk mandiri)",
  schedule: "jadwal kunjungan",
};
export function OutletDelete({
  row,
  onMessage,
}: {
  row: ManagedOutlet;
  onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const navigate = useNavigate();
  const mutation = useOutletMutation(onMessage, async () => {
    setOpen(false);
    await navigate({ to: "/outlets", search: {} });
  });
  const referenced = row.references.length > 0;
  return (
    <div className="flex flex-col gap-2">
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.busy) {
            setOpen(value);
            mutation.setError("");
          }
        }}
      >
        <DialogTrigger
          ref={trigger}
          disabled={referenced}
          aria-describedby={referenced ? reasonId : undefined}
          render={<Button variant="destructive" />}
        >
          <TrashIcon data-icon="inline-start" />
          Hapus Outlet
        </DialogTrigger>
        <DialogContent
          role="alertdialog"
          initialFocus={cancel}
          showCloseButton={!mutation.busy}
          finalFocus={() =>
            trigger.current?.isConnected
              ? trigger.current
              : document.getElementById("outlet-title")
          }
        >
          <DialogHeader>
            <DialogTitle>Hapus Outlet {row.name}?</DialogTitle>
            <DialogDescription>
              Penghapusan permanen dan tidak dapat dibatalkan. Outlet yang
              dirujuk kunjungan, laporan stok, atau jadwal tidak dapat dihapus.
              Riwayat operasional tidak akan ikut dihapus.
            </DialogDescription>
          </DialogHeader>
          <p className="break-all">
            ID bisnis: {row.businessId ?? "Belum tersedia"} · ID internal:{" "}
            {row.id}
          </p>
          {mutation.error && <p role="alert">{mutation.error}</p>}
          <OutletOutcome onMessage={onMessage} />
          <DialogFooter>
            <Button
              ref={cancel}
              variant="outline"
              disabled={mutation.busy}
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={mutation.blocked || referenced}
              onClick={() => void mutation.save("delete", { id: row.id })}
            >
              {mutation.busy ? "Menghapus…" : "Ya, hapus Outlet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {referenced && (
        <p id={reasonId} className="text-muted-foreground text-sm">
          Tidak dapat dihapus:{" "}
          {row.references.map((reason) => labels[reason] ?? reason).join(", ")}.
        </p>
      )}
    </div>
  );
}
