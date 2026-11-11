import { api } from "@/features/auth/session";

export interface ManagedSalesForce {
  id: string;
  name: string;
  createdAt: number;
  accountStatus: string | null;
  supervisorUserId: string | null;
  references: string[];
}
export interface MasterPage {
  items: ManagedSalesForce[];
  next: string | null;
}
export function masterSearch(search: Record<string, unknown>) {
  return {
    q: typeof search.q === "string" ? search.q.slice(0, 200) : "",
    // Stored legacy cursors remain verbatim; the API bounds transport size.
    after: typeof search.after === "string" ? search.after : "",
  };
}
export const loadMaster = (search: ReturnType<typeof masterSearch>) =>
  api<MasterPage>(
    "/admin/sales-force?" + new URLSearchParams({ ...search, limit: "25" })
  );
export const validMasterText = (value: string, max: number) =>
  value.length > 0 &&
  value.length <= max &&
  value.trim() === value &&
  !/[\p{Cc}\p{Cf}]/u.test(value);
export const referenceLabels: Record<string, string> = {
  account: "akun Telegram (termasuk nonaktif)",
  assignment: "penugasan Supervisor",
  assignment_history: "riwayat penugasan",
  schedule: "jadwal kunjungan",
  visit: "kunjungan",
  stock_report: "laporan stok",
  telegram_draft: "draf kunjungan Telegram",
};
export const accountStatusLabels: Record<string, string> = {
  pending: "Menunggu persetujuan",
  active: "Aktif",
  rejected: "Ditolak",
  disabled: "Nonaktif",
};
