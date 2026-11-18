import {
  planningIdSchema,
  webOperationIdSchema,
  type WebOperationOutcome,
} from "@sales-visit/contracts";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { api, ApiError, SessionExpiredError } from "@/features/auth/session";

// A2's tab-scoped safety pattern, with a dedicated Outlet audit/receipt boundary.
const key = "sales-visit.pending-outlet-operation";
const listeners = new Set<() => void>();
let initialized = false;
type OutletAction = "create" | "update" | "delete";
let pending: {
  operationId: string;
  action: OutletAction | null;
  targetOutletId?: string;
} | null = null;
function snapshot() {
  if (!initialized) {
    const stored = sessionStorage.getItem(key);
    if (stored !== null) {
      const legacy = webOperationIdSchema.safeParse(stored);
      if (legacy.success) {
        // Keep pre-upgrade handles recoverable; never discard an unresolved POST.
        pending = { operationId: legacy.data, action: null };
      } else {
        const value = JSON.parse(stored);
        if (!["create", "update", "delete"].includes(value.action))
          throw new Error("Invalid pending Outlet action");
        pending = {
          operationId: webOperationIdSchema.parse(value.operationId),
          action: value.action,
          targetOutletId:
            value.targetOutletId === undefined
              ? undefined
              : planningIdSchema.parse(value.targetOutletId),
        };
      }
    }
    initialized = true;
  }
  return pending;
}
const usePendingOutlet = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, snapshot);
function begin(
  id: string,
  action: OutletAction,
  outletId: string | null | undefined
) {
  if (snapshot()) throw new Error("Unresolved operation");
  const parsed = webOperationIdSchema.parse(id);
  const operation = {
    operationId: parsed,
    action,
    targetOutletId:
      action === "delete" ? planningIdSchema.parse(outletId) : undefined,
  };
  sessionStorage.setItem(key, JSON.stringify(operation)); // must succeed BEFORE POST
  pending = operation;
  listeners.forEach((fn) => fn());
}
function finish(id: string) {
  if (snapshot()?.operationId !== id) return;
  sessionStorage.removeItem(key);
  pending = null;
  listeners.forEach((fn) => fn());
}
export function useOutletMutation(
  onMessage: (message: string) => void,
  onSuccess: () => void | Promise<void>
) {
  const router = useRouter();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unresolved = usePendingOutlet();
  const save = async (
    action: OutletAction,
    input: Record<string, string | null | undefined>
  ) => {
    if (lock.current || snapshot()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let operationId: string | null = null;
    let message = "";
    let succeeded = false;
    try {
      const ticket = await api<{ operationId: string }>(
        "/admin/outlets/operations/new"
      );
      begin(ticket.operationId, action, input.id);
      operationId = ticket.operationId;
      await api("/admin/outlets/" + action, {
        method: "POST",
        body: JSON.stringify({ operationId, ...input }),
      });
      finish(operationId);
      message = "Perubahan Outlet berhasil disimpan.";
      succeeded = true;
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
        try {
          finish(operationId);
          message =
            failure instanceof SessionExpiredError
              ? failure.message
              : failure.status === 409
                ? action === "update"
                  ? "Data telah berubah atau operasi berakhir. Tutup dialog, perbarui data, lalu tinjau kembali."
                  : action === "delete"
                    ? "Outlet masih dirujuk atau operasi berakhir. Perbarui data untuk memeriksa penggunaan."
                    : "ID bisnis sudah digunakan atau operasi berakhir. Periksa daftar sebelum permintaan baru."
                : failure.status === 404
                  ? "Outlet tidak ditemukan. Kembali ke daftar dan perbarui data."
                  : failure.status === 400
                    ? "ID bisnis, nama, atau No. RS tidak valid. Periksa isian."
                    : "Akses tidak diizinkan.";
          setError(message);
        } catch {
          setError(
            "Penanda operasi belum dapat dibersihkan. Periksa hasil operasi."
          );
        }
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
        if (succeeded) await onSuccess();
        await router.invalidate();
      } catch {
        onMessage(
          message + " Data belum dapat diperbarui. Gunakan Perbarui data."
        );
      }
    }
  };
  return { save, busy, error, setError, blocked: busy || Boolean(unresolved) };
}
export function OutletOutcome({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const operation = usePendingOutlet();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  if (!operation) return null;
  const { operationId, action, targetOutletId } = operation;
  const check = async () => {
    setChecking(true);
    setError("");
    try {
      const result = await api<WebOperationOutcome>(
        "/admin/outlets/operations/" + encodeURIComponent(operationId)
      );
      if (snapshot()?.operationId !== operationId) return;
      if (result.status !== "committed" && result.status !== "not_committed") {
        setError(
          "Hasil belum pasti. Tunggu lalu periksa lagi. Jangan kirim ulang."
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
        // Check the live route after lookup: the user may have navigated away.
        if (
          result.status === "committed" &&
          action === "delete" &&
          targetOutletId !== undefined &&
          router.state.matches.some(
            (match) =>
              match.routeId === "/dashboard/outlets/$outletId" &&
              match.params.outletId === targetOutletId
          )
        )
          await router.navigate({ to: "/outlets", search: {} });
        await router.invalidate();
      } catch {
        onMessage(message + " Data belum dapat diperbarui.");
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
      aria-label="Hasil operasi master Outlet"
    >
      <p role="status">
        Hasil perubahan Outlet belum dipastikan. Jangan kirim ulang. Menutup
        dialog atau memuat ulang halaman tidak membatalkan permintaan.
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
