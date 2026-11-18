import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

import { api, ApiError, roleLabel, type Account } from "../session";

export type DemoAccounts = {
  environment: "local" | "staging";
  items: Account[];
};
export function useDemoAccounts() {
  const [data, setData] = useState<DemoAccounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    void api<DemoAccounts>("/auth/demo/accounts")
      .then((result) => {
        if (current) setData(result);
      })
      .catch((failure) => {
        if (current && !(failure instanceof ApiError && failure.status === 404))
          setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [revision]);
  return {
    data,
    loading,
    error,
    retry: () => setRevision((value) => value + 1),
  };
}
export function DemoLogin({
  disabled,
  onLogin,
}: {
  disabled: boolean;
  onLogin: (userId: string) => Promise<void>;
}) {
  const { data, loading, error, retry } = useDemoAccounts();
  if (loading)
    return (
      <div className="flex flex-col gap-2">
        <p role="status">Memeriksa ketersediaan Demo Login…</p>
        <Skeleton className="h-9 w-full" aria-hidden="true" />
      </div>
    );
  if (error)
    return (
      <div className="flex flex-col gap-2">
        <p role="alert">Demo Login belum dapat dimuat.</p>
        <Button variant="outline" disabled={disabled} onClick={retry}>
          Coba lagi
        </Button>
      </div>
    );
  if (!data) return null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="demo-title">
      <h2 id="demo-title" className="font-semibold">
        Demo Login
      </h2>
      <Badge variant="secondary">
        Non-produksi · {data.environment === "local" ? "Lokal" : "Staging"}
      </Badge>
      <p className="text-muted-foreground text-sm">
        Pilih akun untuk masuk tanpa kata sandi. Perubahan tersimpan di
        lingkungan ini.
      </p>
      {!data.items.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Belum ada akun demo aktif</EmptyTitle>
            <EmptyDescription>
              Jalankan seed atau hubungi Admin.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {(["admin", "supervisor", "sales_force"] as const).map((role) => {
        const items = data.items.filter((item) => item.role === role);
        return items.length ? (
          <div key={role} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{roleLabel(role)}</h3>
            {items.map((item) => (
              <Button
                key={item.id}
                variant="outline"
                disabled={disabled}
                onClick={() => void onLogin(item.id)}
              >
                {item.name} · {roleLabel(item.role)}
              </Button>
            ))}
          </div>
        ) : null;
      })}
    </section>
  );
}
