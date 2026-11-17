import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppSidebar } from "@/app/components/app-sidebar";
import { DashboardBreadcrumbs } from "@/app/components/dashboard-breadcrumbs";
import { useTheme } from "@/app/providers/theme-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAccount } from "@/features/auth/session";

export function DashboardLayout() {
  const account = useAccount();
  useEffect(() => {
    if (!account) location.replace("/login");
  }, [account]);
  const { theme, setTheme } = useTheme();
  return (
    <TooltipProvider>
      <SidebarProvider>
        <a
          href="#dashboard-content"
          className="focus:bg-background sr-only focus:not-sr-only focus:absolute focus:rounded-md focus:p-4"
        >
          Lewati ke konten utama
        </a>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 md:px-6">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <DashboardBreadcrumbs />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ganti tema warna"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                <SunIcon className="hidden dark:block" />
                <MoonIcon className="dark:hidden" />
              </Button>
            </div>
          </header>
          <div
            id="dashboard-content"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 outline-none md:p-6 lg:p-8"
          >
            <Outlet />
          </div>
          <footer className="text-muted-foreground px-4 py-4 text-xs md:px-8">
            Sales Visit · Data sesuai hak akses · Waktu dalam WIB.
          </footer>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
