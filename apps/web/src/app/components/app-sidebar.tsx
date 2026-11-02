import {
  ClipboardTextIcon,
  DatabaseIcon,
  MapPinIcon,
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

const navigation = [
  { title: "Kunjungan", to: "/visits", icon: ClipboardTextIcon },
  { title: "Data referensi", to: "/directory", icon: DatabaseIcon },
] as const;

// Adapted from the official shadcn/ui sidebar-07 block (Base UI / nova).
export function AppSidebar() {
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
              render={<Link to="/visits" search={{}} />}
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
              {navigation.map(({ title, to, icon: Icon }) => (
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
              Sales Force dapat melapor melalui Dashboard Web atau Telegram Bot.
            </p>
            <p>Data yang ditampilkan adalah data contoh.</p>
          </div>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 overflow-hidden p-2">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback>SV</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 text-xs group-data-[collapsible=icon]:hidden">
            <span className="truncate font-medium">Ruang kerja demo</span>
            <span className="text-muted-foreground truncate">
              Sales Force · Admin · Supervisor
            </span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
