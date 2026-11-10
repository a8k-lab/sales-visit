import { useLoaderData, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { OperationalRefresh } from "@/components/operational-state";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccount } from "@/features/auth/session";

import { accountStatusLabels, referenceLabels } from "./data";
import { MasterEditor } from "./editor";
import { MasterOutcome } from "./mutation";

export function SalesForceManagementPage() {
  const account = useAccount();
  const page = useLoaderData({ from: "/dashboard/master/sales-force" });
  const search = useSearch({ from: "/dashboard/master/sales-force" });
  const navigate = useNavigate({ from: "/master/sales-force" });
  const [message, setMessage] = useState("");
  if (account?.role !== "admin")
    return <p role="alert">Halaman ini hanya untuk Admin.</p>;
  return (
    <section className="flex flex-col gap-6" aria-labelledby="master-title">
      <div className="flex flex-col gap-2">
        <h1 id="master-title" tabIndex={-1} className="text-2xl font-semibold">
          Kelola Sales Force
        </h1>
        <p className="text-muted-foreground text-sm">
          Kelola master bisnis Sales Force. Akun didaftarkan secara mandiri
          melalui Telegram, lalu disetujui melalui Pengguna &amp; Akses.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <MasterEditor onMessage={setMessage} />
        <OperationalRefresh />
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <MasterOutcome onMessage={setMessage} />
      <Field>
        <FieldLabel htmlFor="master-search">
          Cari nama atau kode Sales Force
        </FieldLabel>
        <Input
          id="master-search"
          value={search.q}
          maxLength={200}
          onChange={(e) =>
            void navigate({
              search: { q: e.target.value, after: "" },
              replace: true,
              resetScroll: false,
            })
          }
        />
      </Field>
      {!page.items.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Belum ada Sales Force yang sesuai</EmptyTitle>
            <EmptyDescription>
              Tambahkan master Sales Force baru atau ubah pencarian.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Kode (tetap)</TableHead>
              <TableHead>Asosiasi akun</TableHead>
              <TableHead>Supervisor</TableHead>
              <TableHead>Dibuat (WIB)</TableHead>
              <TableHead>Penggunaan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-normal">{row.name}</TableCell>
                <TableCell className="break-all whitespace-normal">
                  {row.id}
                </TableCell>
                <TableCell>
                  {row.accountStatus
                    ? row.accountStatus
                        .split(", ")
                        .map(
                          (status) => accountStatusLabels[status] ?? "Tertaut"
                        )
                        .join(", ")
                    : "Belum tertaut"}
                </TableCell>
                <TableCell>
                  {row.supervisorUserId
                    ? "Sudah ditugaskan"
                    : "Belum ditugaskan"}
                </TableCell>
                <TableCell>
                  {new Date(row.createdAt).toLocaleString("id-ID", {
                    timeZone: "Asia/Jakarta",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {row.references
                    .map((reason) => referenceLabels[reason] ?? reason)
                    .join(", ") || "Belum digunakan"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!search.after}
          onClick={() => void navigate({ search: { ...search, after: "" } })}
        >
          Halaman pertama
        </Button>
        <Button
          variant="outline"
          disabled={!page.next}
          onClick={() =>
            void navigate({ search: { ...search, after: page.next! } })
          }
        >
          Berikutnya
        </Button>
      </div>
    </section>
  );
}
