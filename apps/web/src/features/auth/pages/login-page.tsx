import { MapPinIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";

import { useTheme } from "@/app/providers/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoginForm } from "@/features/auth/components/login-form";

// Preserve login-03's centered, single-column card and muted background.
export function LoginPage() {
  const { theme, setTheme } = useTheme();

  return (
    <main className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <MapPinIcon className="size-5" weight="fill" aria-hidden="true" />
          </div>
          Sales Visit
        </div>
        <div className="flex items-center justify-center gap-2">
          <Badge variant="outline">Prototipe</Badge>
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
        <LoginForm />
      </div>
    </main>
  );
}
