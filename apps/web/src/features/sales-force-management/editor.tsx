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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { validMasterText, type ManagedSalesForce } from "./data";
import { MasterOutcome, useMasterMutation } from "./mutation";

export function MasterEditor({
  row,
  onMessage,
}: {
  row?: ManagedSalesForce;
  onMessage: (message: string) => void;
}) {
  const fieldId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [expectedName, setExpectedName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const mutation = useMasterMutation(onMessage, () => setOpen(false));
  const idInvalid = !row && !validMasterText(id, 128);
  const title = row ? "Ubah nama" : "Tambah Sales Force";
  const nameInvalid = !validMasterText(name, 200);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (mutation.busy) return;
        if (value) {
          setId(row?.id ?? "");
          setName(row?.name ?? "");
          setExpectedName(row?.name ?? "");
          setSubmitted(false);
          mutation.setError("");
        }
        setOpen(value);
      }}
    >
      <DialogTrigger
        ref={trigger}
        render={
          <Button
            variant={row ? "outline" : "default"}
            size={row ? "sm" : "default"}
          />
        }
      >
        {title}
      </DialogTrigger>
      <DialogContent
        showCloseButton={!mutation.busy}
        finalFocus={() =>
          trigger.current?.isConnected
            ? trigger.current
            : document.getElementById("master-title")
        }
        className="max-h-[90dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {row
              ? "Nama baru juga akan tampil pada laporan historis yang merujuk Sales Force ini. Kode tidak dapat diubah."
              : "Buat master bisnis saja, bukan akun Telegram. Kode tidak dapat diubah setelah disimpan."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (!idInvalid && !nameInvalid)
              void mutation.save(row ? "rename" : "create", {
                id,
                name,
                ...(row ? { expectedName } : {}),
              });
          }}
          noValidate
        >
          <FieldGroup>
            {row ? (
              <p className="text-muted-foreground text-sm break-all">
                Kode Sales Force (tetap): {id}
              </p>
            ) : (
              <Field data-invalid={submitted && idInvalid}>
                <FieldLabel htmlFor={fieldId + "-id"}>
                  Kode Sales Force
                </FieldLabel>
                <Input
                  id={fieldId + "-id"}
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  maxLength={128}
                  disabled={mutation.blocked}
                  aria-invalid={submitted && idInvalid}
                  aria-describedby={fieldId + "-id-help"}
                />
                <p
                  id={fieldId + "-id-help"}
                  className="text-muted-foreground text-sm"
                >
                  Wajib 1–128 karakter; tanpa spasi awal/akhir atau karakter
                  kontrol. Huruf besar/kecil dipertahankan. Contoh:
                  SF-TIMIKA-6-BRIAN.
                </p>
              </Field>
            )}
            <Field data-invalid={submitted && nameInvalid}>
              <FieldLabel htmlFor={fieldId + "-name"}>
                Nama Sales Force
              </FieldLabel>
              <Input
                id={fieldId + "-name"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                disabled={mutation.blocked}
                aria-invalid={submitted && nameInvalid}
                aria-describedby={
                  submitted && nameInvalid ? fieldId + "-name-help" : undefined
                }
              />
              {submitted && nameInvalid && (
                <p id={fieldId + "-name-help"} role="alert">
                  Nama wajib 1–200 karakter, tanpa spasi awal/akhir atau
                  karakter kontrol.
                </p>
              )}
            </Field>
          </FieldGroup>
          {submitted && idInvalid && (
            <p role="alert">
              Periksa kode Sales Force sesuai ketentuan di atas.
            </p>
          )}
          {mutation.error && <p role="alert">{mutation.error}</p>}
          <MasterOutcome onMessage={onMessage} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.busy}
              onClick={() => setOpen(false)}
            >
              Tutup
            </Button>
            <Button type="submit" disabled={mutation.blocked}>
              {mutation.busy ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
