import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";

import { AppSidebar } from "@/components/app-sidebar";
import { useTheme } from "@/components/theme-provider";
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

export function DashboardLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { theme, setTheme } = useTheme();
  const isDetail = pathname.startsWith("/visits/");
  return (
    <TooltipProvider>
      <SidebarProvider>
        <a
          href="#dashboard-content"
          className="focus:bg-background sr-only focus:not-sr-only focus:absolute focus:rounded-md focus:p-4"
        >
          Skip to content
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
                    <BreadcrumbLink render={<Link to="/visits" search={{}} />}>
                      Visits
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>
                      {pathname === "/directory" ? "Reference data" : "Visits"}
                    </BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {isDetail && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>Visit details</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="outline">Mock data</Badge>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Toggle color theme"
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
            Sales Visit prototype · All people, outlets, and reports shown are
            synthetic.
          </footer>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
