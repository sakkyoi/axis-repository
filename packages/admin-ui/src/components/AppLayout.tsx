import { NavLink, Outlet } from "react-router-dom";
import { KeyRound, LogOut, Package, Settings, ShieldCheck } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { useAuth } from "../auth";
import { getRuntimeConfig } from "../runtime-config";

const navItems = [
  { to: "/repositories", label: "Repositories", icon: Package },
  { to: "/tokens", label: "Tokens", icon: ShieldCheck },
  { to: "/signing-keys", label: "Signing Keys", icon: KeyRound },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  const auth = useAuth();
  const apiBaseUrl = getRuntimeConfig().apiBaseUrl || "same-origin";

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-background text-foreground">
      <aside className="border-r border-border bg-panel">
        <div className="flex h-14 items-center border-b border-border px-5">
          <div>
            <div className="text-sm font-semibold">Axis Repository</div>
            <div className="text-xs text-muted-foreground">Admin Console</div>
          </div>
        </div>
        <nav className="grid gap-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                  isActive && "bg-muted text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex h-14 items-center justify-between border-b border-border bg-panel px-5">
          <div className="text-sm text-muted-foreground">API target: {apiBaseUrl}</div>
          <div className="flex items-center gap-2">
            <Badge variant="success">Signed in</Badge>
            <Button type="button" variant="outline" onClick={auth.logout}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </header>
        <main className="p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
