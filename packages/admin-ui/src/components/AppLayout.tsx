import { NavLink, Outlet } from "react-router-dom";
import { LogOut, Monitor, Moon, Package, Settings, ShieldCheck, Sun } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { useAuth } from "../auth";
import { createAxisClient } from "../api/client";
import { ADMIN_UI_NAV_ITEMS } from "../navigation";
import { getRuntimeConfig } from "../runtime-config";
import { useTheme, type ThemePreference } from "../theme";

const navIcons = {
  repositories: Package,
  tokens: ShieldCheck,
  settings: Settings,
} as const;

const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Monitor }> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function AppLayout() {
  const auth = useAuth();
  const theme = useTheme();
  const apiBaseUrl = getRuntimeConfig().apiBaseUrl || "same-origin";

  async function logout() {
    try {
      await createAxisClient({
        accessToken: auth.accessToken,
        baseUrl: getRuntimeConfig().apiBaseUrl,
      }).logoutAdmin();
    } finally {
      auth.logout();
    }
  }

  return (
    <div className="grid h-screen overflow-hidden grid-cols-[240px_minmax(0,1fr)] bg-background text-foreground">
      <aside className="h-screen overflow-y-auto border-r border-border bg-panel">
        <div className="flex h-14 items-center border-b border-border px-5">
          <div>
            <div className="text-sm font-semibold">Axis Repository</div>
            <div className="text-xs text-muted-foreground">Admin Console</div>
          </div>
        </div>
        <nav className="grid gap-1 p-3">
          {ADMIN_UI_NAV_ITEMS.map((item) => {
            const Icon = navIcons[item.id];
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    isActive && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <div className="grid min-h-0 min-w-0 grid-rows-[56px_minmax(0,1fr)]">
        <header className="flex min-w-0 items-center justify-between border-b border-border bg-panel/95 px-5">
          <div className="text-sm text-muted-foreground">API target: {apiBaseUrl}</div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 items-center rounded-md border border-border bg-background p-0.5">
              {themeOptions.map((option) => {
                const Icon = option.icon;
                const isActive = theme.preference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      isActive && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                    )}
                    onClick={() => theme.setPreference(option.value)}
                    aria-pressed={isActive}
                    title={`${option.label} theme`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {option.label}
                  </button>
                );
              })}
            </div>
            <Badge variant="success">Signed in</Badge>
            <Button type="button" variant="outline" onClick={() => void logout()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </header>
        <main className="min-h-0 overflow-hidden p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
