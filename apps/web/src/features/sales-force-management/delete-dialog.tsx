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

import { referenceLabels, type ManagedSalesForce } from "./data";
import { MasterOutcome, useMasterMutation } from "./mutation";

// Equivalent accessible destructive confirmation using the installed modal Dialog.
export function MasterDelete({
  row,
  onMessage,
}: {
  row: ManagedSalesForce;
  onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const mutation = useMasterMutation(onMessage, () => setOpen(false));
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
          render={<Button variant="destructive" size="sm" />}
        >
          Hapus
        </DialogTrigger>
        <DialogContent
          role="alertdialog"
          initialFocus={cancel}
          showCloseButton={!mutation.busy}
          finalFocus={() =>
            trigger.current?.isConnected
              ? trigger.current
              : document.getElementById("master-title")
          }
          className="max-h-[90dvh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Hapus Sales Force {row.name}?</DialogTitle>
            <DialogDescription>
              Penghapusan tidak dapat dibatalkan. Sales Force yang dirujuk akun,
              penugasan, riwayat, jadwal, laporan, atau draf Telegram tidak
              dapat dihapus. Data dan aktivitas terkait tidak akan ikut dihapus.
            </DialogDescription>
          </DialogHeader>
          <p className="break-all">Kode: {row.id}</p>
          {mutation.error && <p role="alert">{mutation.error}</p>}
          <MasterOutcome onMessage={onMessage} />
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
              {mutation.busy ? "Menghapus…" : "Ya, hapus Sales Force"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {referenced && (
        <p
          id={reasonId}
          className="text-muted-foreground text-xs whitespace-normal"
        >
          Tidak dapat dihapus:{" "}
          {row.references
            .map((reason) => referenceLabels[reason] ?? reason)
            .join(", ")}
          .
        </p>
      )}
    </div>
  );
}
