import type { Account, UserPage } from "@sales-visit/contracts";

import { api } from "@/features/auth/session";

export type UserSearch = {
  after: string;
  pendingAfter: string;
  status: string;
};
export function userSearch(search: Record<string, unknown>): UserSearch {
  return {
    after: typeof search.after === "string" ? search.after.slice(0, 256) : "",
    pendingAfter:
      typeof search.pendingAfter === "string"
        ? search.pendingAfter.slice(0, 256)
        : "",
    status:
      typeof search.status === "string" &&
      ["pending", "active", "rejected", "disabled"].includes(search.status)
        ? search.status
        : "",
  };
}
export async function loadUsers(search: UserSearch) {
  const [pending, users] = await Promise.all([
    api<UserPage>(
      `/admin/users?status=pending&limit=25&after=${encodeURIComponent(search.pendingAfter)}`
    ),
    api<UserPage>(
      `/admin/users?limit=25&status=${search.status}&after=${encodeURIComponent(search.after)}`
    ),
  ]);
  return { pending, users };
}
export const accountName = (row: Account) =>
  [row.firstName, row.lastName].filter(Boolean).join(" ") || "Akun Telegram";
export const statusLabels = {
  pending: "Menunggu persetujuan",
  active: "Aktif",
  disabled: "Nonaktif",
  rejected: "Ditolak",
};
export type SalesForceOptions = {
  items: { id: string; name: string }[];
  next: string | null;
};
