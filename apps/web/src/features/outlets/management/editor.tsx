import { PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import {
  createOutletSchema,
  updateOutletSchema,
  type OutletDetail,
} from "@sales-visit/contracts";
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

import { OutletOutcome, useOutletMutation } from "./mutation";

export function OutletEditor({
  row,
  onMessage,
}: {
  row?: OutletDetail;
  onMessage: (message: string) => void;
}) {
  const fieldId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [businessId, setBusinessId] = useState("");
  const [name, setName] = useState("");
  const [noRs, setNoRs] = useState("");
  const [original, setOriginal] = useState<OutletDetail | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const mutation = useOutletMutation(onMessage, () => setOpen(false));
  const title = row ? "Ubah Outlet" : "Tambah Outlet";
  const values = original
    ? {
        id: original.id,
        name,
        ...(original.noRs === null && noRs === "" ? {} : { noRs }),
      }
    : { businessId, name, noRs };
  const validation = (
    original ? updateOutletSchema : createOutletSchema
  ).safeParse(values);
  const invalid = (field: string) =>
    submitted &&
    !validation.success &&
    validation.error.issues.some(
      (issue) => issue.path[0] === field || issue.code === "invalid_union"
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (mutation.busy) return;
        if (value) {
          setOriginal(row ? { ...row } : null);
          setBusinessId(row?.businessId ?? "");
          setName(row?.name ?? "");
          setNoRs(row?.noRs ?? "");
          setSubmitted(false);
          mutation.setError("");
        }
        setOpen(value);
      }}
    >
      <DialogTrigger
        ref={trigger}
        render={<Button variant={row ? "outline" : "default"} />}
      >
        {row ? (
          <PencilSimpleIcon data-icon="inline-start" />
        ) : (
          <PlusIcon data-icon="inline-start" />
        )}
        {title}
      </DialogTrigger>
      <DialogContent
        showCloseButton={!mutation.busy}
        finalFocus={() =>
          trigger.current?.isConnected
            ? trigger.current
            : document.getElementById("outlet-title")
        }
        className="max-h-[90dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {row
              ? "ID bisnis tidak dapat diubah. Nama baru juga tampil pada riwayat laporan yang merujuk Outlet ini."
              : "Buat master bisnis Outlet, bukan akun pengguna. ID bisnis unik, peka huruf besar/kecil, dan tidak dapat diubah."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (validation.success)
              void mutation.save(original ? "update" : "create", {
                ...values,
                ...(original
                  ? { expectedName: original.name, expectedNoRs: original.noRs }
                  : {}),
              });
          }}
        >
          <FieldGroup>
            {row ? (
              <p className="text-muted-foreground text-sm break-all">
                ID bisnis (tetap): {businessId || "Belum tersedia (data lama)"}
              </p>
            ) : (
              <Field data-invalid={invalid("businessId")}>
                <FieldLabel htmlFor={fieldId + "-business"}>
                  ID bisnis
                </FieldLabel>
                <Input
                  id={fieldId + "-business"}
                  value={businessId}
                  onChange={(e) => setBusinessId(e.target.value)}
                  maxLength={256}
                  disabled={mutation.blocked}
                  aria-invalid={invalid("businessId")}
                  aria-describedby={fieldId + "-key-help"}
                />
              </Field>
            )}
            <Field data-invalid={invalid("name")}>
              <FieldLabel htmlFor={fieldId + "-name"}>Nama Outlet</FieldLabel>
              <Input
                id={fieldId + "-name"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={256}
                disabled={mutation.blocked}
                aria-invalid={invalid("name")}
                aria-describedby={fieldId + "-name-help"}
              />
              <p
                id={fieldId + "-name-help"}
                className="text-muted-foreground text-sm"
              >
                Wajib 1–256 karakter setelah spasi awal/akhir dirapikan; tanpa
                karakter kontrol.
              </p>
            </Field>
            <Field data-invalid={invalid("noRs")}>
              <FieldLabel htmlFor={fieldId + "-rs"}>No. RS</FieldLabel>
              <Input
                id={fieldId + "-rs"}
                value={noRs}
                onChange={(e) => setNoRs(e.target.value)}
                maxLength={256}
                disabled={mutation.blocked}
                aria-invalid={invalid("noRs")}
                aria-describedby={fieldId + "-key-help"}
              />
            </Field>
            <p
              id={fieldId + "-key-help"}
              className="text-muted-foreground text-sm"
            >
              ID bisnis dan No. RS wajib 1–256 karakter, tidak boleh hanya spasi
              atau berisi karakter kontrol. Nilai disimpan persis, termasuk
              spasi. No. RS bukan nomor telepon.{" "}
              {row?.noRs === null
                ? "Kosongkan No. RS untuk mempertahankan data lama yang belum tersedia."
                : "No. RS yang sudah tersedia tidak dapat dikosongkan."}
            </p>
          </FieldGroup>
          {submitted && !validation.success && (
            <p role="alert">
              Periksa ID bisnis, nama, dan No. RS sesuai ketentuan di atas.
            </p>
          )}
          {mutation.error && <p role="alert">{mutation.error}</p>}
          <OutletOutcome onMessage={onMessage} />
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
