import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Monitor, Moon, Package, PanelLeftClose, Settings, ShieldCheck, Sun, Users } from "lucide-react";
import { AxisBrand, AxisLogoMark } from "./brand/axis-brand";
import { cn } from "../lib/utils";
import { ADMIN_UI_NAV_ITEMS } from "../navigation";
import { ProfileMenu } from "../profile/profile-menu";
import { SIDEBAR_LABELS_NEED_PX, sidebarCollapsed, sidebarToggleLabel, sidebarWidthPx } from "./sidebar-model";
import { useTheme, type ThemePreference } from "../theme";

const navIcons = {
  repositories: Package,
  tokens: ShieldCheck,
  users: Users,
  settings: Settings,
} as const;

const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Monitor }> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function AppLayout() {
  const theme = useTheme();
  const [chosen, setChosen] = useState<boolean>();
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? SIDEBAR_LABELS_NEED_PX : window.innerWidth);
  const collapsed = sidebarCollapsed({ ...(chosen === undefined ? {} : { chosen }), viewportWidth });
  const toggleLabel = sidebarToggleLabel(collapsed);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      className="grid h-screen overflow-hidden bg-background text-foreground"
      style={{ gridTemplateColumns: `${sidebarWidthPx(collapsed)}px minmax(0,1fr)` }}
    >
      <aside className="h-screen overflow-y-auto overflow-x-hidden border-r border-border bg-panel">
        <div className={cn("flex h-14 items-center border-b border-border", collapsed ? "justify-center px-2" : "gap-2 px-5")}>
          {collapsed ? (
            // Only the mark, which is also what expands it again: at this width
            // there is no room for a control beside the thing it acts on.
            <button
              type="button"
              onClick={() => setChosen(false)}
              aria-label={toggleLabel}
              title={toggleLabel}
              className="rounded-md p-1 transition-colors hover:bg-muted"
            >
              <AxisLogoMark className="h-8 w-8" />
            </button>
          ) : (
            <>
              <AxisBrand subtitle="Admin Console" markClassName="h-8 w-8" className="min-w-0 flex-1" />
              <button
                type="button"
                onClick={() => setChosen(true)}
                aria-label={toggleLabel}
                title={toggleLabel}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        <nav className="grid gap-1 p-3">
          {ADMIN_UI_NAV_ITEMS.map((item) => {
            const Icon = navIcons[item.id];
            return (
              <NavLink
                key={item.to}
                to={item.to}
                // Collapsed, the name is gone from the page but not from the
                // link: it is what a screen reader reads and what a pointer
                // hovering the icon is told.
                aria-label={item.label}
                {...(collapsed ? { title: item.label } : {})}
                className={({ isActive }) =>
                  cn(
                    "flex h-9 items-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    collapsed ? "justify-center px-0" : "gap-2 px-3",
                    isActive && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && item.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <div className="grid min-h-0 min-w-0 grid-rows-[56px_minmax(0,1fr)]">
        <header className="flex min-w-0 items-center justify-end border-b border-border bg-panel/95 px-5">
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
            <ProfileMenu />
          </div>
        </header>
        <main className="min-h-0 overflow-hidden p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
