import type { Account } from "@sales-visit/contracts";
import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  api,
  ApiError,
  SessionExpiredError,
  roleLabel,
} from "@/features/auth/session";

import { accountName, type SalesForceOptions } from "./data";
import { OperationOutcome } from "./operation-outcome";
import {
  beginOperation,
  finishOperation,
  usePendingOperation,
} from "./operation-state";

type Action = "approve" | "reject" | "role" | "disable" | "enable";
const labels: Record<Action, string> = {
  approve: "Setujui",
  reject: "Tolak",
  role: "Ubah role",
  disable: "Nonaktifkan",
  enable: "Aktifkan kembali",
};
const consequences: Record<Action, string> = {
  role: "Perubahan role langsung mengubah akses akun. Penugasan Supervisor tetap tersimpan, tetapi akses pemantauan hanya berlaku untuk Supervisor aktif. Promosi ke Admin memberikan hak pengelolaan penuh dan dilindungi dari penurunan role.",
  disable:
    "Akun akan langsung kehilangan akses Web dan Telegram Bot. Role, asosiasi Sales Force, serta penugasan Supervisor tetap tersimpan.",
  enable:
    "Akun akan memperoleh kembali akses sesuai role dan penugasan yang tersimpan. Pastikan akses tersebut masih sesuai.",
  approve:
    "Pilih satu role untuk memberikan akses akun. Identitas tetap berasal dari registrasi Telegram.",
  reject:
    "Penolakan bersifat final. Akun tidak dapat diaktifkan atau mendaftar ulang melalui alur saat ini.",
};
const roles = ["admin", "supervisor", "sales_force"] as const;

export function AccountAction({
  row,
  action,
  onMessage,
}: {
  row: Account;
  action: Action;
  onMessage: (message: string) => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<NonNullable<Account["role"]>>(
    row.role ?? "supervisor"
  );
  const [salesForceId, setSalesForceId] = useState(row.salesForceId ?? "");
  const [options, setOptions] = useState<SalesForceOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [optionError, setOptionError] = useState(false);
  const [optionRevision, setOptionRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  // Invalidate every request from an earlier opening, role, retry, or unmount.
  const optionGeneration = useRef(0);
  const invalidateOptions = () => {
    optionGeneration.current += 1;
    setLoading(false);
  };
  const pendingOperation = usePendingOperation();
  const [error, setError] = useState("");
  const needsRole = action === "approve" || action === "role";
  useEffect(() => {
    setLoading(false);
    if (!open || !needsRole || role !== "sales_force" || row.salesForceId)
      return;
    const generation = ++optionGeneration.current;
    const current = () => generation === optionGeneration.current;
    setLoading(true);
    setOptionError(false);
    void api<SalesForceOptions>("/admin/users/sales-force-options")
      .then((page) => {
        if (current()) setOptions(page);
      })
      .catch(() => {
        if (current()) setOptionError(true);
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => {
      optionGeneration.current += 1;
    };
  }, [open, needsRole, role, optionRevision, row.salesForceId]);
  const moreOptions = async () => {
    if (!options?.next || loading) return;
    const generation = optionGeneration.current;
    const current = () => generation === optionGeneration.current;
    setLoading(true);
    setOptionError(false);
    try {
      const page = await api<SalesForceOptions>(
        "/admin/users/sales-force-options?after=" +
          encodeURIComponent(options.next)
      );
      if (current())
        setOptions(
          (previous) =>
            previous && {
              items: [...previous.items, ...page.items],
              next: page.next,
            }
        );
    } catch {
      if (current()) setOptionError(true);
    } finally {
      if (current()) setLoading(false);
    }
  };
  const save = async () => {
    if (submitting.current || pendingOperation) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    let operationId: string | null = null;
    let message = "";
    try {
      const ticket = await api<{ operationId: string }>(
        "/admin/users/operations/new"
      );
      beginOperation(ticket.operationId); // durable tab lock BEFORE sending POST
      operationId = ticket.operationId;
      await api("/admin/users/" + action, {
        method: "POST",
        body: JSON.stringify({
          operationId,
          userId: row.id,
          ...(needsRole
            ? { role, ...(role === "sales_force" ? { salesForceId } : {}) }
            : {}),
        }),
      });
      finishOperation(operationId);
      message = `${labels[action]} akun ${accountName(row)} berhasil.`;
      setOpen(false);
    } catch (failure) {
      if (!operationId) {
        setError(
          "Perubahan belum dikirim. Periksa koneksi dan hasil operasi sebelumnya."
        );
      } else if (
        failure instanceof SessionExpiredError ||
        (failure instanceof ApiError &&
          [400, 403, 404, 409].includes(failure.status))
      ) {
        // A definitive application rejection completes this request. Do not
        // claim the account is unchanged; refresh it and let the Admin review.
        try {
          finishOperation(operationId);
          message =
            failure instanceof SessionExpiredError
              ? failure.message
              : `Permintaan berakhir dengan HTTP ${failure.status}, tanpa respons sukses. Periksa data akun sebelum melakukan tindakan lagi.`;
          setError(message);
        } catch {
          setError(
            "Respons diterima, tetapi penanda operasi belum dapat dibersihkan. Periksa hasil operasi."
          );
        }
      } else {
        // Unknown HTTP errors (e.g. proxy 408), transport/JSON errors and 5xx may hide a
        // committed or still-running write. No account GET can unlock this.
        setError(
          "Hasil perubahan belum pasti. Jangan kirim ulang; periksa hasil operasi."
        );
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
    if (message) {
      onMessage(message);
      // This read failure is NOT a failed/uncertain POST.
      try {
        await router.invalidate();
      } catch {
        onMessage(
          message +
            " Daftar belum dapat diperbarui. Muat ulang data sebelum melanjutkan."
        );
      }
    }
  };
  const sfOptions = row.salesForceId
    ? [{ id: row.salesForceId, name: "Asosiasi tersimpan" }]
    : (options?.items ?? []);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          invalidateOptions();
          if (value) {
            setRole(row.role ?? "supervisor");
            setSalesForceId(row.salesForceId ?? "");
            setOptions(null);
            setOptionError(false);
          }
          setOpen(value);
          setError("");
        }
      }}
    >
      <DialogTrigger
        ref={triggerRef}
        render={<Button variant="outline" size="sm" />}
      >
        {labels[action]}
      </DialogTrigger>
      <DialogContent
        finalFocus={() =>
          triggerRef.current?.isConnected
            ? triggerRef.current
            : document.getElementById("users-title")
        }
        showCloseButton={!busy}
        className="max-h-[90dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {labels[action]} akun {accountName(row)}?
          </DialogTitle>
          <DialogDescription>{consequences[action]}</DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Telegram: {row.username ? "@" + row.username + " · " : ""}
          {row.telegramUserId}
        </p>
        {row.salesForceId && (
          <p className="text-muted-foreground text-sm">
            Asosiasi Sales Force {row.salesForceId} dipertahankan dan tidak
            dapat diganti.
          </p>
        )}
        {needsRole && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={fieldId + "-role"}>Role akun</FieldLabel>
              <Select
                items={roles.map((value) => ({
                  value,
                  label: roleLabel(value),
                }))}
                value={role}
                disabled={busy || Boolean(pendingOperation)}
                onValueChange={(value) => {
                  if (value) {
                    invalidateOptions();
                    setOptions(null);
                    setOptionError(false);
                    setRole(value);
                    setSalesForceId(row.salesForceId ?? "");
                  }
                }}
              >
                <SelectTrigger id={fieldId + "-role"}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {roles.map((value) => (
                      <SelectItem key={value} value={value}>
                        {roleLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {role === "sales_force" && (
              <Field>
                <FieldLabel htmlFor={fieldId + "-sf"}>
                  Master Sales Force
                </FieldLabel>
                <Select
                  items={sfOptions.map((sf) => ({
                    value: sf.id,
                    label: `${sf.name} (${sf.id})`,
                  }))}
                  value={salesForceId}
                  disabled={
                    busy || Boolean(pendingOperation) || loading || optionError
                  }
                  onValueChange={(value) => setSalesForceId(value ?? "")}
                >
                  <SelectTrigger id={fieldId + "-sf"}>
                    <SelectValue placeholder="Pilih Sales Force" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {sfOptions.map((sf) => (
                        <SelectItem key={sf.id} value={sf.id}>
                          {sf.name} ({sf.id})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {loading && <p role="status">Memuat Sales Force…</p>}
                {optionError ? (
                  <>
                    <p role="alert">Gagal memuat Sales Force.</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        invalidateOptions();
                        setOptionRevision((v) => v + 1);
                      }}
                    >
                      Coba lagi
                    </Button>
                  </>
                ) : (
                  options &&
                  !loading &&
                  !sfOptions.length && (
                    <p>
                      Belum ada Sales Force yang tersedia. Tambahkan master
                      Sales Force terlebih dahulu.{" "}
                      <Link
                        to="/master/sales-force"
                        search={{ q: "", after: "" }}
                        className="underline"
                      >
                        Buka Kelola Sales Force
                      </Link>
                    </p>
                  )
                )}
                {options?.next && (
                  <Button
                    variant="outline"
                    disabled={loading || busy || Boolean(pendingOperation)}
                    onClick={() => void moreOptions()}
                  >
                    Muat Sales Force berikutnya
                  </Button>
                )}
              </Field>
            )}
          </FieldGroup>
        )}
        {busy && <p role="status">Menyimpan atau memeriksa status akun…</p>}
        {error && <p role="alert">{error}</p>}
        <OperationOutcome
          onMessage={onMessage}
          onResolved={() => setOpen(false)}
          disabled={busy}
        />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              invalidateOptions();
              setOpen(false);
            }}
          >
            {pendingOperation ? "Tutup — hasil belum pasti" : "Batal"}
          </Button>
          {!pendingOperation && (
            <Button
              variant={
                action === "reject" || action === "disable"
                  ? "destructive"
                  : "default"
              }
              disabled={
                busy ||
                (needsRole &&
                  role === "sales_force" &&
                  (!salesForceId || loading || optionError))
              }
              onClick={() => void save()}
            >
              {busy ? "Menyimpan…" : `Ya, ${labels[action].toLowerCase()}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
