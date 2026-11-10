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

import { validMasterText } from "./data";
import { MasterOutcome, useMasterMutation } from "./mutation";

export function MasterEditor({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const fieldId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const mutation = useMasterMutation(onMessage, () => setOpen(false));
  const idInvalid = !validMasterText(id, 128);
  const nameInvalid = !validMasterText(name, 200);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (mutation.busy) return;
        if (value) {
          setId("");
          setName("");
          setSubmitted(false);
          mutation.setError("");
        }
        setOpen(value);
      }}
    >
      <DialogTrigger ref={trigger} render={<Button />}>
        Tambah Sales Force
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
          <DialogTitle>Tambah Sales Force</DialogTitle>
          <DialogDescription>
            Buat master bisnis saja, bukan akun Telegram. Kode tidak dapat
            diubah setelah disimpan.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (!idInvalid && !nameInvalid)
              void mutation.save("create", { id, name });
          }}
          noValidate
        >
          <FieldGroup>
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
                aria-describedby={fieldId + "-name-help"}
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
