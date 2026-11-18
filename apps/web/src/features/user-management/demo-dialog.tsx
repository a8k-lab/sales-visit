import { Link, useRouter } from "@tanstack/react-router";
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
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDemoAccounts } from "@/features/auth/components/demo-login";
import {
  api,
  ApiError,
  SessionExpiredError,
  roleLabel,
  type Account,
} from "@/features/auth/session";

import type { SalesForceOptions } from "./data";
import {
  beginOperation,
  finishOperation,
  usePendingOperation,
} from "./operation-state";

export function DemoAccountDialog({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const {
    data,
    loading: discovering,
    error: discoveryError,
    retry,
  } = useDemoAccounts();
  const router = useRouter();
  const pending = usePendingOperation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Account["role"]>("supervisor");
  const [sf, setSf] = useState("");
  const [options, setOptions] = useState<SalesForceOptions>({
    items: [],
    next: null,
  });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  // Match AccountAction: invalidate initial and paginated requests together.
  const optionGeneration = useRef(0);
  const invalidateOptions = () => {
    optionGeneration.current += 1;
    setLoading(false);
  };
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(false);
    if (!open || role !== "sales_force") return;
    const generation = ++optionGeneration.current;
    const current = () => generation === optionGeneration.current;
    setLoading(true);
    void api<SalesForceOptions>("/admin/users/sales-force-options")
      .then((result) => {
        if (current()) setOptions(result);
      })
      .catch(() => {
        if (current())
          setError(
            "Daftar Sales Force tidak dapat dimuat. Tutup lalu coba lagi."
          );
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => {
      optionGeneration.current += 1;
    };
  }, [open, role]);
  async function more() {
    if (!open || role !== "sales_force" || !options.next || loading) return;
    const generation = optionGeneration.current;
    const current = () => generation === optionGeneration.current;
    setLoading(true);
    try {
      const result = await api<SalesForceOptions>(
        `/admin/users/sales-force-options?after=${encodeURIComponent(options.next)}`
      );
      if (current())
        setOptions((prev) => ({
          items: [...prev.items, ...result.items],
          next: result.next,
        }));
    } catch {
      if (current()) setError("Daftar Sales Force tidak dapat dimuat.");
    } finally {
      if (current()) setLoading(false);
    }
  }
  async function save() {
    if (submitting.current || pending) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    let operationId: string | null = null;
    try {
      const ticket = await api<{ operationId: string }>(
        "/admin/users/operations/new"
      );
      beginOperation(ticket.operationId);
      operationId = ticket.operationId;
      await api("/admin/users/demo", {
        method: "POST",
        body: JSON.stringify({
          displayName: name,
          role,
          ...(role === "sales_force" ? { salesForceId: sf } : {}),
          operationId,
        }),
      });
      finishOperation(operationId);
      setOpen(false);
      setName("");
      setSf("");
      setRole("supervisor");
      onMessage("Akun demo berhasil dibuat.");
      try {
        await router.invalidate();
      } catch {
        onMessage("Akun dibuat. Muat ulang daftar pengguna.");
      }
    } catch (failure) {
      const definitive =
        failure instanceof SessionExpiredError ||
        (failure instanceof ApiError &&
          [400, 403, 404, 409].includes(failure.status));
      if (operationId && definitive) finishOperation(operationId);
      setError(
        operationId && !definitive
          ? "Hasil belum pasti. Jangan kirim ulang; periksa hasil operasi di halaman pengguna."
          : "Akun belum dibuat. Periksa akses, nama, dan ketersediaan Sales Force."
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (discovering)
    return <p role="status">Memeriksa ketersediaan akun demo…</p>;
  if (discoveryError)
    return (
      <div className="flex flex-col gap-2">
        <p role="alert">Fitur Tambah Akun Demo belum dapat dimuat.</p>
        <Button variant="outline" onClick={retry}>
          Coba lagi
        </Button>
      </div>
    );
  if (!data) return null;
  const roles = ["admin", "supervisor", "sales_force"] as const;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          invalidateOptions();
          if (value) {
            setOptions({ items: [], next: null });
            setSf("");
          }
          setOpen(value);
          setError("");
        }
      }}
    >
      <DialogTrigger render={<Button />}>Tambah Akun Demo</DialogTrigger>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Tambah Akun Demo</DialogTitle>
          <DialogDescription>
            Akun aktif tanpa Telegram, hanya untuk lingkungan non-produksi.
            Admin baru dilindungi dari penonaktifan dan penurunan role.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="flex flex-col gap-4"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="demo-name">Nama tampilan</FieldLabel>
              <Input
                id="demo-name"
                required
                maxLength={256}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="demo-role">Role</FieldLabel>
              <Select
                value={role}
                disabled={busy}
                items={roles.map((value) => ({
                  value,
                  label: roleLabel(value),
                }))}
                onValueChange={(value) => {
                  invalidateOptions();
                  setOptions({ items: [], next: null });
                  if (value) setRole(value);
                  setSf("");
                  setError("");
                }}
              >
                <SelectTrigger id="demo-role">
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
                <FieldLabel htmlFor="demo-sf">
                  Sales Force tanpa pemilik
                </FieldLabel>
                <Select
                  value={sf}
                  disabled={busy || loading}
                  items={options.items.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                  onValueChange={(value) => setSf(value ?? "")}
                >
                  <SelectTrigger id="demo-sf">
                    <SelectValue placeholder="Pilih Sales Force" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {options.items.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {loading && <p role="status">Memuat Sales Force…</p>}
                {!loading && !error && !options.items.length && (
                  <p>
                    Belum ada master Sales Force tanpa pemilik. Tambahkan master
                    Sales Force terlebih dahulu.{" "}
                    <Link
                      to="/master/sales-force"
                      search={{ q: "", after: "" }}
                      className="underline"
                    >
                      Buka Kelola Sales Force
                    </Link>
                  </p>
                )}
                {options.next && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || loading}
                    onClick={() => void more()}
                  >
                    Muat lainnya
                  </Button>
                )}
              </Field>
            )}
          </FieldGroup>
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                busy ||
                !!pending ||
                !name.trim() ||
                (role === "sales_force" && !sf)
              }
            >
              {busy ? "Menyimpan…" : "Buat akun"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
