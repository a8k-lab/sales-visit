import type { WebOperationOutcome } from "@sales-visit/contracts";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { api } from "@/features/auth/session";

import {
  finishOperation,
  isPendingOperation,
  usePendingOperation,
} from "./operation-state";

type OutcomeProps = {
  onMessage: (message: string) => void;
  onResolved?: () => void;
  disabled?: boolean;
};
export function OperationOutcome(props: OutcomeProps) {
  const operationId = usePendingOperation();
  return operationId ? (
    <OperationLookup key={operationId} operationId={operationId} {...props} />
  ) : null;
}
function OperationLookup({
  operationId,
  onMessage,
  onResolved,
  disabled = false,
}: OutcomeProps & { operationId: string }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const check = async () => {
    setChecking(true);
    setError("");
    try {
      const outcome = await api<WebOperationOutcome>(
        "/admin/users/operations/" + encodeURIComponent(operationId)
      );
      if (!isPendingOperation(operationId)) return;
      // Only explicit terminal outcomes unlock writes. Neither account state nor
      // elapsed browser time nor a malformed/failed lookup is sufficient.
      if (
        outcome.status !== "committed" &&
        outcome.status !== "not_committed"
      ) {
        setError(
          "Hasil belum pasti. Permintaan masih dapat diproses. Periksa lagi beberapa saat; jangan kirim ulang."
        );
        return;
      }
      const message =
        outcome.status === "committed"
          ? "Perubahan sebelumnya tercatat. Data akun terbaru dapat berbeda jika ada perubahan lain."
          : "Tidak ada perubahan tersimpan dari operasi sebelumnya dan operasi itu tidak dapat mengubah akun lagi. Periksa data sebelum membuat permintaan baru.";
      finishOperation(operationId);
      onMessage(message);
      onResolved?.();
      // A list refresh failure must not turn a proven outcome back into an
      // ambiguous mutation or encourage another POST.
      try {
        await router.invalidate();
      } catch {
        onMessage(
          message +
            " Daftar belum dapat diperbarui. Muat ulang data sebelum melanjutkan."
        );
      }
    } catch {
      setError(
        "Hasil belum dapat diverifikasi. Periksa koneksi atau masuk kembali sebagai Admin, lalu periksa hasil operasi."
      );
    } finally {
      setChecking(false);
    }
  };
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Hasil perubahan akun belum dipastikan</EmptyTitle>
        <EmptyDescription>
          Jangan kirim ulang perubahan. Periksa hasil operasi sebelumnya untuk
          membuka tindakan akun lainnya. Menutup dialog atau memuat ulang
          halaman tidak membatalkan permintaan.
        </EmptyDescription>
      </EmptyHeader>
      {error && <p role="alert">{error}</p>}
      <Button
        variant="outline"
        disabled={disabled || checking}
        onClick={() => void check()}
      >
        {checking ? "Memeriksa hasil…" : "Periksa hasil operasi"}
      </Button>
    </Empty>
  );
}
