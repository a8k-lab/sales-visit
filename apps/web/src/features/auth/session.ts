import { useSyncExternalStore } from "react";

export interface Account {
  id: string;
  name: string;
  role: "admin" | "supervisor" | "sales_force";
  salesForceId: string | null;
}
const key = "sales-visit.web-session";
let account: Account | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
export const useAccount = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => account
  );
export const currentAccount = () => account;
function token() {
  return sessionStorage.getItem(key);
}
export function clearSession() {
  sessionStorage.removeItem(key);
  account = null;
  notify();
}
const base = import.meta.env.VITE_API_URL as string | undefined;
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (
    !base ||
    (!base.startsWith("https://") &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base))
  )
    throw new Error("Layanan login belum tersedia.");
  const headers = new Headers(init.headers);
  const credential = token();
  if (credential) headers.set("Authorization", `Bearer ${credential}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401) {
    clearSession();
    throw new Error("Sesi berakhir atau login ditolak. Silakan masuk kembali.");
  }
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "Akses tidak diizinkan."
        : "Layanan tidak tersedia. Silakan coba lagi."
    );
  return response.json() as Promise<T>;
}
export async function restoreSession() {
  if (!token()) {
    account = null;
    return null;
  }
  const result = await api<{ account: Account }>("/auth/me");
  account = result.account;
  notify();
  return account;
}
export async function finishLogin(idToken: string, challenge: string) {
  const result = await api<{ token: string; account: Account }>(
    "/auth/telegram",
    { method: "POST", body: JSON.stringify({ idToken, challenge }) }
  );
  sessionStorage.setItem(key, result.token);
  account = result.account;
  notify();
}
export async function logout() {
  // Keep the credential on network failure so revocation can be retried.
  await api("/auth/logout", { method: "POST" });
  clearSession();
}
export function safeReturn(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\/(overview|visits|outlets|directory)(\/|\?|$)/.test(value) ||
    value.includes("\\") ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    return "/overview";
  return value;
}
export const roleLabel = (role: Account["role"]) =>
  ({ admin: "Admin", supervisor: "Supervisor", sales_force: "Sales Force" })[
    role
  ];
