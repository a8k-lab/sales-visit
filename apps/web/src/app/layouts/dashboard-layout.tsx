import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppSidebar } from "@/app/components/app-sidebar";
import { useTheme } from "@/app/providers/theme-provider";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  logout,
  restoreSession,
  useAccount,
  roleLabel,
} from "@/features/auth/session";

export function DashboardLayout() {
  const account = useAccount();
  useEffect(() => {
    if (!account) location.replace("/login");
  }, [account]);
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    const check = () => {
      void restoreSession()
        .then((user) => {
          if (!user) location.replace("/login");
        })
        .catch(() => {});
    };
    const timer = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { theme, setTheme } = useTheme();
  const isAssignment =
    pathname.replace(/\/+$/, "") === "/supervisor-assignments";
  const isOutlet = pathname === "/outlets" || pathname.startsWith("/outlets/");
  const isDetail =
    pathname.startsWith("/visits/") || pathname.startsWith("/outlets/");
  const isNewVisit = pathname === "/visits/new";
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
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  {isDetail ? (
                    <BreadcrumbLink
                      render={
                        <Link
                          to={isOutlet ? "/outlets" : "/visits"}
                          search={{}}
                        />
                      }
                    >
                      {isOutlet ? "Outlet" : "Kunjungan"}
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>
                      {isAssignment
                        ? "Penugasan Supervisor"
                        : pathname === "/overview"
                          ? "Ringkasan"
                          : pathname === "/directory"
                            ? "Data referensi"
                            : isOutlet
                              ? "Outlet"
                              : "Kunjungan"}
                    </BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {isDetail && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>
                        {isNewVisit
                          ? "Catat Kunjungan"
                          : isOutlet
                            ? "Detail Outlet"
                            : "Detail kunjungan"}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="outline">
                {isAssignment ? "Data operasional" : "Demo · Data contoh"}
              </Badge>
              <span className="text-sm">
                {account?.name} · {account && roleLabel(account.role)}
              </span>
              <Button
                variant="outline"
                disabled={loggingOut}
                onClick={() => {
                  setLoggingOut(true);
                  setLogoutError("");
                  void logout()
                    .then(() => location.replace("/login"))
                    .catch(() => {
                      setLoggingOut(false);
                      setLogoutError(
                        "Gagal keluar. Periksa koneksi lalu coba lagi."
                      );
                    });
                }}
              >
                Keluar
              </Button>
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
            {logoutError && <p role="alert">{logoutError}</p>}
            {!isAssignment && (
              <p className="text-muted-foreground text-sm">
                Demo sintetis — bukan laporan operasional. Perubahan formulir
                hanya disimpan di browser ini, tidak dikirim ke server.
              </p>
            )}
            <Outlet />
          </div>
          <footer className="text-muted-foreground px-4 py-4 text-xs md:px-8">
            Sales Visit · Login terverifikasi. Laporan Dashboard memakai data
            contoh. Penugasan Supervisor disimpan di server.
          </footer>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
