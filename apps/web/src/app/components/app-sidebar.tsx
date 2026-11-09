import {
  ChartBarIcon,
  ClipboardTextIcon,
  DatabaseIcon,
  MapPinIcon,
  StorefrontIcon,
} from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { useAccount, roleLabel } from "@/features/auth/session";

const navigation = [
  { title: "Ringkasan", to: "/overview", icon: ChartBarIcon },
  { title: "Kunjungan", to: "/visits", icon: ClipboardTextIcon },
  { title: "Outlet", to: "/outlets", icon: StorefrontIcon },
  { title: "Data referensi", to: "/directory", icon: DatabaseIcon },
  {
    title: "Penugasan Supervisor",
    to: "/supervisor-assignments",
    icon: DatabaseIcon,
  },
] as const;

// Adapted from the official shadcn/ui sidebar-07 block (Base UI / nova).
export function AppSidebar() {
  const account = useAccount();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link to="/overview" />}
              onClick={() => setOpenMobile(false)}
            >
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <MapPinIcon className="size-5" weight="fill" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Sales Visit</span>
                <span className="text-muted-foreground truncate text-xs">
                  Citra Indah · Bandung
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Ruang kerja</SidebarGroupLabel>
          <nav aria-label="Navigasi utama">
            <SidebarMenu>
              {navigation
                .filter(
                  (item) =>
                    (item.to !== "/directory" ||
                      account?.role !== "sales_force") &&
                    (item.to !== "/supervisor-assignments" ||
                      account?.role === "admin")
                )
                .map(({ title, to, icon: Icon }) => (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton
                      tooltip={title}
                      isActive={pathname.startsWith(to)}
                      render={<Link to={to} search={{}} />}
                      onClick={() => setOpenMobile(false)}
                    >
                      <Icon />
                      <span>{title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </nav>
        </SidebarGroup>
        <SidebarGroup className="mt-auto group-data-[collapsible=icon]:hidden">
          <div className="text-muted-foreground flex flex-col gap-2 rounded-lg border p-3 text-xs">
            <span className="text-foreground font-medium">
              Satu alur pelaporan, dua pilihan.
            </span>
            <p>
              Pelaporan operasional melalui Telegram Bot. Formulir Web hanya
              simulasi lokal.
            </p>
            <p>
              Laporan memakai data contoh. Penugasan Supervisor memakai data
              operasional.
            </p>
          </div>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 overflow-hidden p-2">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback>SV</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 text-xs group-data-[collapsible=icon]:hidden">
            <span className="truncate font-medium">{account?.name}</span>
            <span className="text-muted-foreground truncate">
              {account && roleLabel(account.role)}
            </span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
