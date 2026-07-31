import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Monitor, Moon, Package, PanelLeftClose, Settings, ShieldCheck, Sun, Users } from "lucide-react";
import { AxisBrand, AxisLogoMark } from "./brand/axis-brand";
import { GithubMark } from "./brand/github-mark";
import { cn } from "../lib/utils";
import { ADMIN_UI_NAV_ITEMS, AXIS_SOURCE_URL } from "../navigation";
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

/** The theme, as the three states it can be asked for. */
function ThemeChoice({ collapsed }: { collapsed: boolean }) {
  const theme = useTheme();
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-background p-0.5",
        collapsed ? "grid gap-0.5" : "flex h-9 items-center",
      )}
      role="group"
      aria-label="Theme"
    >
      {themeOptions.map((option) => {
        const Icon = option.icon;
        const isActive = theme.preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              "inline-flex items-center rounded text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              collapsed ? "h-7 justify-center" : "h-7 flex-1 justify-center gap-1.5 px-2",
              isActive && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
            )}
            onClick={() => theme.setPreference(option.value)}
            aria-pressed={isActive}
            aria-label={collapsed ? `${option.label} theme` : undefined}
            title={`${option.label} theme`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && option.label}
          </button>
        );
      })}
    </div>
  );
}

export function AppLayout() {
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
      {/* The panel itself does not scroll: a scrolling box clips what escapes
          it, and the account menu at the foot is wider than the panel is when
          it is collapsed. The list of destinations scrolls instead, which is
          the only part that can outgrow the screen. */}
      <aside className="flex h-screen flex-col border-r border-border bg-panel">
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
        <nav className="grid min-h-0 flex-1 auto-rows-min gap-1 overflow-y-auto overflow-x-hidden p-3">
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
        {/* Pushed to the foot of the panel. These belong to whoever is signed
            in rather than to the page, and on a narrow screen the top bar had
            no room for them beside anything else. */}
        <div className={cn("grid gap-2 border-t border-border", collapsed ? "p-2" : "p-3")}>
          <ThemeChoice collapsed={collapsed} />
          <ProfileMenu collapsed={collapsed} />
        </div>
      </aside>
      <div className="grid min-h-0 min-w-0 grid-rows-[56px_minmax(0,1fr)]">
        <header className="flex min-w-0 items-center justify-end border-b border-border bg-panel/95 px-5">
          <a
            href={AXIS_SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Axis Repository on GitHub"
            title="Axis Repository on GitHub"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <GithubMark className="h-5 w-5" />
          </a>
        </header>
        <main className="min-h-0 overflow-hidden p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
