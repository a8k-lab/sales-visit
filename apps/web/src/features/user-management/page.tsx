import type { ManagedAccount, UserPage } from "@sales-visit/contracts";
import {
  Link,
  useLoaderData,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { roleLabel, useAccount } from "@/features/auth/session";

import { AccountAction } from "./action-dialog";
import { accountName, statusLabels } from "./data";

function UserTable({
  page,
  onMessage,
}: {
  page: UserPage;
  onMessage: (message: string) => void;
}) {
  if (!page.items.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Tidak ada pengguna</EmptyTitle>
          <EmptyDescription>
            Registrasi dilakukan sendiri melalui Telegram Bot. Akun baru akan
            tampil setelah pengguna mendaftar.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nama / Telegram</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Sales Force</TableHead>
          <TableHead>Terdaftar (WIB)</TableHead>
          <TableHead>Tindakan</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {page.items.map((row) => (
          <UserRow key={row.id} row={row} onMessage={onMessage} />
        ))}
      </TableBody>
    </Table>
  );
}
function UserRow({
  row,
  onMessage,
}: {
  row: ManagedAccount;
  onMessage: (message: string) => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <p>{accountName(row)}</p>
        <p className="text-muted-foreground text-xs">
          {row.username ? "@" + row.username + " · " : ""}
          {row.telegramUserId}
        </p>
      </TableCell>
      <TableCell>
        {row.role ? roleLabel(row.role) : "Belum ditentukan"}
      </TableCell>
      <TableCell>
        <Badge variant={row.status === "active" ? "default" : "secondary"}>
          {statusLabels[row.status]}
        </Badge>
      </TableCell>
      <TableCell>{row.salesForceName ?? row.salesForceId ?? "—"}</TableCell>
      <TableCell>
        {new Date(row.createdAt).toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          {row.status === "active" && row.role !== "admin" && (
            <>
              <AccountAction row={row} action="role" onMessage={onMessage} />
              <AccountAction row={row} action="disable" onMessage={onMessage} />
            </>
          )}
          {row.status === "active" && row.role === "admin" && (
            <span className="text-muted-foreground text-xs">
              Admin dilindungi
            </span>
          )}
          {row.status === "disabled" && (
            <AccountAction row={row} action="enable" onMessage={onMessage} />
          )}
          {row.status === "rejected" && (
            <span className="text-muted-foreground text-xs">
              Keputusan final
            </span>
          )}
          {row.status === "pending" && (
            <>
              <AccountAction row={row} action="approve" onMessage={onMessage} />
              <AccountAction row={row} action="reject" onMessage={onMessage} />
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
export function UserManagementPage() {
  const account = useAccount();
  const { pending, users } = useLoaderData({ from: "/dashboard/users" });
  const search = useSearch({ from: "/dashboard/users" });
  const navigate = useNavigate({ from: "/users" });
  const [message, setMessage] = useState("");
  if (account?.role !== "admin")
    return (
      <p role="alert">Akses tidak diizinkan. Halaman ini hanya untuk Admin.</p>
    );
  const pagination = (page: UserPage, key: "after" | "pendingAfter") => (
    <div className="flex gap-2">
      <Button
        variant="outline"
        disabled={!search[key]}
        onClick={() =>
          void navigate({ search: (prev) => ({ ...prev, [key]: "" }) })
        }
      >
        Halaman pertama
      </Button>
      <Button
        variant="outline"
        disabled={!page.next}
        onClick={() =>
          void navigate({ search: (prev) => ({ ...prev, [key]: page.next! }) })
        }
      >
        Berikutnya
      </Button>
    </div>
  );
  return (
    <section className="flex flex-col gap-6" aria-labelledby="users-title">
      <div className="flex flex-col gap-2">
        <h1 id="users-title" tabIndex={-1} className="text-2xl font-semibold">
          Pengguna &amp; Akses
        </h1>
        <p className="text-muted-foreground text-sm">
          Tinjau registrasi Telegram dan kelola akses akun. Identitas Telegram
          tidak dapat dibuat atau diganti di sini.
        </p>
        <Link to="/supervisor-assignments" className="text-sm underline">
          Kelola Penugasan Supervisor
        </Link>
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <section className="flex flex-col gap-4" aria-labelledby="pending-title">
        <h2 id="pending-title" className="text-lg font-semibold">
          Permintaan registrasi
        </h2>
        <UserTable page={pending} onMessage={setMessage} />
        {pagination(pending, "pendingAfter")}
      </section>
      <section
        className="flex flex-col gap-4"
        aria-labelledby="all-users-title"
      >
        <h2 id="all-users-title" className="text-lg font-semibold">
          Semua pengguna
        </h2>
        <Field className="max-w-xs">
          <FieldLabel htmlFor="user-status">Status akun</FieldLabel>
          <Select
            items={[
              { value: "", label: "Semua status" },
              ...Object.entries(statusLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            value={search.status}
            onValueChange={(status) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  status: status ?? "",
                  after: "",
                }),
              })
            }
          >
            <SelectTrigger id="user-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="">Semua status</SelectItem>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <UserTable page={users} onMessage={setMessage} />
        {pagination(users, "after")}
      </section>
    </section>
  );
}
