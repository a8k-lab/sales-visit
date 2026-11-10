import {
  webOperationIdSchema,
  type WebOperationOutcome,
} from "@sales-visit/contracts";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { api, ApiError, SessionExpiredError } from "@/features/auth/session";

// Separate from A1: this handle is resolved ONLY against master-data audit.
const key = "sales-visit.pending-master-operation";
const listeners = new Set<() => void>();
let initialized = false;
let pending: string | null = null;
function snapshot() {
  if (!initialized) {
    const stored = sessionStorage.getItem(key);
    pending = stored === null ? null : webOperationIdSchema.parse(stored);
    initialized = true;
  }
  return pending;
}
export const usePendingMaster = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, snapshot);
function begin(id: string) {
  if (snapshot()) throw new Error("Unresolved operation");
  const parsed = webOperationIdSchema.parse(id);
  sessionStorage.setItem(key, parsed); // must succeed BEFORE POST
  pending = parsed;
  listeners.forEach((fn) => fn());
}
function finish(id: string) {
  if (snapshot() !== id) return;
  sessionStorage.removeItem(key);
  pending = null;
  listeners.forEach((fn) => fn());
}
export function useMasterMutation(
  onMessage: (message: string) => void,
  onSuccess: () => void
) {
  const router = useRouter();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unresolved = usePendingMaster();
  const save = async (
    action: "create" | "rename" | "delete",
    input: Record<string, string>
  ) => {
    if (lock.current || snapshot()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let operationId: string | null = null;
    let message = "";
    try {
      const ticket = await api<{ operationId: string }>(
        "/admin/sales-force/operations/new"
      );
      begin(ticket.operationId);
      operationId = ticket.operationId;
      await api("/admin/sales-force/" + action, {
        method: "POST",
        body: JSON.stringify({ operationId, ...input }),
      });
      finish(operationId);
      message = "Perubahan Sales Force berhasil disimpan.";
      onSuccess();
    } catch (failure) {
      if (!operationId)
        setError(
          "Perubahan belum dikirim. Periksa koneksi dan hasil operasi sebelumnya."
        );
      else if (
        failure instanceof SessionExpiredError ||
        (failure instanceof ApiError &&
          [400, 403, 404, 409].includes(failure.status))
      ) {
        finish(operationId);
        message =
          failure instanceof SessionExpiredError
            ? failure.message
            : failure.status === 409
              ? "Perubahan ditolak: kode sudah digunakan, nama telah berubah, atau data masih dirujuk. Perbarui data dan tinjau kembali sebelum melanjutkan."
              : failure.status === 404
                ? "Sales Force tidak ditemukan. Perbarui data."
                : failure.status === 400
                  ? "Kode atau nama tidak valid. Periksa isian."
                  : "Akses tidak diizinkan.";
        setError(message);
      } else
        setError(
          "Hasil perubahan belum pasti. Jangan kirim ulang; periksa hasil operasi."
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
    if (message) {
      onMessage(message);
      try {
        await router.invalidate();
      } catch {
        onMessage(
          message + " Daftar belum dapat diperbarui. Gunakan Perbarui data."
        );
      }
    }
  };
  return { save, busy, error, setError, blocked: busy || Boolean(unresolved) };
}
export function MasterOutcome({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const operationId = usePendingMaster();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  if (!operationId) return null;
  const check = async () => {
    setChecking(true);
    setError("");
    try {
      const result = await api<WebOperationOutcome>(
        "/admin/sales-force/operations/" + encodeURIComponent(operationId)
      );
      if (snapshot() !== operationId) return;
      if (result.status !== "committed" && result.status !== "not_committed") {
        setError(
          "Hasil belum pasti. Tunggu beberapa saat lalu periksa lagi. Jangan kirim ulang."
        );
        return;
      }
      finish(operationId);
      const message =
        result.status === "committed"
          ? "Perubahan sebelumnya tercatat. Periksa data terbaru sebelum tindakan lain."
          : "Operasi sebelumnya tidak menyimpan perubahan dan tidak dapat diproses lagi. Periksa data sebelum tindakan baru.";
      onMessage(message);
      try {
        await router.invalidate();
      } catch {
        onMessage(message + " Daftar belum dapat diperbarui.");
      }
    } catch {
      setError(
        "Hasil belum dapat diperiksa. Periksa koneksi atau masuk kembali sebagai Admin."
      );
    } finally {
      setChecking(false);
    }
  };
  return (
    <section
      className="flex flex-col gap-2"
      aria-label="Hasil operasi master Sales Force"
    >
      <p role="status">
        Hasil perubahan Sales Force belum dipastikan. Jangan kirim ulang.
        Menutup dialog atau memuat ulang halaman tidak membatalkan permintaan.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button
        variant="outline"
        disabled={checking}
        onClick={() => void check()}
      >
        {checking ? "Memeriksa…" : "Periksa hasil operasi"}
      </Button>
    </section>
  );
}
