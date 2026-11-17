import {
  ChartBarIcon,
  ClipboardTextIcon,
  MapPinIcon,
  StorefrontIcon,
  PackageIcon,
  UsersIcon,
  UserGearIcon,
  TreeStructureIcon,
  NotebookIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { logout, useAccount, roleLabel } from "@/features/auth/session";

const navigation = [
  {
    title: "Ruang kerja",
    to: "/workspace",
    icon: ChartBarIcon,
    group: "Ruang kerja",
  },
  {
    title: "Ringkasan",
    to: "/overview",
    icon: ChartBarIcon,
    group: "Monitoring",
  },
  {
    title: "Kunjungan",
    to: "/visits",
    icon: ClipboardTextIcon,
    group: "Monitoring",
  },
  {
    title: "Laporan stok",
    to: "/directory",
    kind: "stock-reports",
    icon: NotebookIcon,
    group: "Monitoring",
  },
  {
    title: "Outlet",
    to: "/outlets",
    icon: StorefrontIcon,
    group: "Data / Referensi",
  },
  {
    title: "Sales Force",
    to: "/directory",
    kind: "sales-force",
    icon: UsersIcon,
    group: "Data / Referensi",
  },
  {
    title: "Produk",
    to: "/directory",
    kind: "products",
    icon: PackageIcon,
    group: "Data / Referensi",
  },
  {
    title: "Kelola Sales Force",
    to: "/master/sales-force",
    icon: UsersIcon,
    group: "Administrasi",
  },
  {
    title: "Pengguna & Akses",
    to: "/users",
    icon: UserGearIcon,
    group: "Administrasi",
  },
  {
    title: "Penugasan Supervisor",
    to: "/supervisor-assignments",
    icon: TreeStructureIcon,
    group: "Administrasi",
  },
] as const;

// Adapted from the official shadcn/ui sidebar-07 block (Base UI / nova).
export function AppSidebar() {
  const account = useAccount();
  const location = useRouterState({ select: (state) => state.location });
  const { setOpenMobile } = useSidebar();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const items = navigation.filter((item) =>
    account?.role === "sales_force"
      ? item.to === "/workspace"
      : item.to !== "/workspace" &&
        (item.group !== "Administrasi" || account?.role === "admin")
  );
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Sales Visit"
              className="group-data-[collapsible=icon]:justify-center"
              render={
                <Link
                  to={
                    account?.role === "sales_force" ? "/workspace" : "/overview"
                  }
                />
              }
              onClick={() => setOpenMobile(false)}
            >
              <MapPinIcon aria-hidden="true" />
              <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
                Sales Visit
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {[...new Set(items.map((item) => item.group))].map((group) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel>{group}</SidebarGroupLabel>
            <nav aria-label={group}>
              <SidebarMenu>
                {items
                  .filter((item) => item.group === group)
                  .map((item) => {
                    const kind = "kind" in item ? item.kind : undefined;
                    const active = kind
                      ? location.pathname === "/directory" &&
                        location.search.kind === kind
                      : location.pathname === item.to ||
                        location.pathname.startsWith(`${item.to}/`);
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          tooltip={item.title}
                          isActive={active}
                          render={
                            <Link
                              to={item.to}
                              search={kind ? { kind } : {}}
                              aria-current={active ? "page" : undefined}
                            />
                          }
                          onClick={() => setOpenMobile(false)}
                        >
                          <item.icon aria-hidden="true" />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
              </SidebarMenu>
            </nav>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <Dialog>
          <SidebarMenu>
            <SidebarMenuItem>
              <DialogTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    tooltip="Akun & keluar"
                    className="group-data-[collapsible=icon]:justify-center"
                  />
                }
                aria-label="Akun & keluar"
              >
                <UserGearIcon aria-hidden="true" />
                <span className="grid min-w-0 text-left group-data-[collapsible=icon]:hidden">
                  <span className="truncate">{account?.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {account && roleLabel(account.role)}
                  </span>
                </span>
              </DialogTrigger>
            </SidebarMenuItem>
          </SidebarMenu>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Akun</DialogTitle>
              <DialogDescription className="break-words">
                {account?.name} · {account && roleLabel(account.role)}
              </DialogDescription>
            </DialogHeader>
            {error && <p role="alert">{error}</p>}
            <Button
              variant="outline"
              disabled={loggingOut}
              onClick={() => {
                setLoggingOut(true);
                setError("");
                void logout()
                  .then(() => window.location.replace("/login"))
                  .catch(() => {
                    setLoggingOut(false);
                    setError("Gagal keluar. Periksa koneksi lalu coba lagi.");
                  });
              }}
            >
              <SignOutIcon data-icon="inline-start" />
              {loggingOut ? "Keluar…" : "Keluar"}
            </Button>
          </DialogContent>
        </Dialog>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
