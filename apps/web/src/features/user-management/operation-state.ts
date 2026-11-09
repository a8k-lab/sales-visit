import { webOperationIdSchema } from "@sales-visit/contracts";
import { useSyncExternalStore } from "react";

// Tab-scoped, credential-free recovery handle. Keep it through row unmounts,
// navigation, reload, and reauthentication; none proves a POST has stopped.
const key = "sales-visit.pending-account-operation";
const listeners = new Set<() => void>();
let initialized = false;
let pending: string | null = null;
function snapshot() {
  if (!initialized) {
    const stored = sessionStorage.getItem(key);
    // Corrupt/unavailable recovery storage fails closed rather than silently
    // permitting another privileged request with an untracked predecessor.
    pending = stored === null ? null : webOperationIdSchema.parse(stored);
    initialized = true;
  }
  return pending;
}
export const usePendingOperation = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, snapshot);
export const isPendingOperation = (operationId: string) =>
  snapshot() === operationId;

export function beginOperation(operationId: string) {
  if (snapshot())
    throw new Error("Periksa hasil perubahan sebelumnya terlebih dahulu.");
  const parsed = webOperationIdSchema.parse(operationId);
  // Persist before POST. If storage fails, the caller must not send the write.
  sessionStorage.setItem(key, parsed);
  pending = parsed;
  listeners.forEach((listener) => listener());
}
export function finishOperation(operationId: string) {
  if (snapshot() !== operationId) return;
  sessionStorage.removeItem(key);
  pending = null;
  listeners.forEach((listener) => listener());
}
