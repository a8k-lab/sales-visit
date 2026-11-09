import type { Account } from "@sales-visit/contracts";
import { useRouter } from "@tanstack/react-router";
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
import { api, ApiError, roleLabel } from "@/features/auth/session";

import { accountName, statusLabels, type SalesForceOptions } from "./data";

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
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const needsRole = action === "approve" || action === "role";
  useEffect(() => {
    if (!open || !needsRole || role !== "sales_force" || row.salesForceId)
      return;
    let cancelled = false;
    setLoading(true);
    setOptionError(false);
    void api<SalesForceOptions>("/admin/users/sales-force-options")
      .then((page) => {
        if (!cancelled) setOptions(page);
      })
      .catch(() => {
        if (!cancelled) setOptionError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, needsRole, role, optionRevision, row.salesForceId]);
  const moreOptions = async () => {
    if (!options?.next) return;
    setLoading(true);
    setOptionError(false);
    try {
      const page = await api<SalesForceOptions>(
        "/admin/users/sales-force-options?after=" +
          encodeURIComponent(options.next)
      );
      setOptions({ items: [...options.items, ...page.items], next: page.next });
    } catch {
      setOptionError(true);
    } finally {
      setLoading(false);
    }
  };
  const reconcile = async () => {
    // No automatic mutation retries. Require an authoritative target read before
    // allowing another attempt, even if a timeout happened after D1 committed.
    const current = await api<Account>(
      "/admin/users/" + encodeURIComponent(row.id)
    );
    await router.invalidate();
    onMessage(
      `Status terbaru ${accountName(current)}: ${statusLabels[current.status]}, role ${current.role ? roleLabel(current.role) : "belum ditentukan"}. Periksa hasil sebelum melakukan tindakan lagi.`
    );
    setUncertain(false);
    setOpen(false);
  };
  const save = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/admin/users/" + action, {
        method: "POST",
        body: JSON.stringify({
          userId: row.id,
          ...(needsRole
            ? { role, ...(role === "sales_force" ? { salesForceId } : {}) }
            : {}),
        }),
      });
      // Mark uncertain until both lists have refreshed successfully.
      setUncertain(true);
      await router.invalidate();
      onMessage(`${labels[action]} akun ${accountName(row)} berhasil.`);
      setUncertain(false);
      setOpen(false);
    } catch (failure) {
      setUncertain(true);
      setError(
        failure instanceof ApiError && failure.status === 409
          ? "Perubahan ditolak. Status, role, atau asosiasi akun mungkin sudah berubah."
          : "Hasil belum dapat dipastikan. Memeriksa status terbaru…"
      );
      try {
        await reconcile();
      } catch {
        setError(
          "Status belum dapat diperiksa. Periksa koneksi lalu verifikasi status sebelum mencoba lagi."
        );
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const sfOptions = row.salesForceId
    ? [{ id: row.salesForceId, name: "Asosiasi tersimpan" }]
    : (options?.items ?? []);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy && !uncertain) {
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
        showCloseButton={!busy && !uncertain}
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
                disabled={busy || uncertain}
                onValueChange={(value) => {
                  if (value) {
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
                  disabled={busy || uncertain || loading || optionError}
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
                      onClick={() => setOptionRevision((v) => v + 1)}
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
                      Sales Force terlebih dahulu.
                    </p>
                  )
                )}
                {options?.next && (
                  <Button
                    variant="outline"
                    disabled={loading || busy || uncertain}
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
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy || uncertain}
            onClick={() => setOpen(false)}
          >
            Batal
          </Button>
          {uncertain ? (
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void reconcile()
                  .catch(() =>
                    setError("Status belum dapat diperiksa. Coba lagi.")
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Verifikasi status terbaru
            </Button>
          ) : (
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
