import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Monitor, Moon, Package, PanelLeftClose, Settings, ShieldCheck, Sun, Users } from "lucide-react";
import { AxisBrand, AxisLogoMark } from "./brand/axis-brand";
import { BootstrapCredentialsBanner } from "./bootstrap-credentials";
import { GithubMark } from "./brand/github-mark";
import { cn } from "../lib/utils";
import { ADMIN_UI_NAV_ITEMS, AXIS_SOURCE_URL } from "../navigation";
import { ProfileMenu } from "../profile/profile-menu";
import {
  SIDEBAR_LABELS_NEED_PX,
  readStoredSidebarChoice,
  sidebarCollapsed,
  sidebarToggleLabel,
  sidebarWidthPx,
  storeSidebarChoice,
} from "./sidebar-model";
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
              // No marker here: a segment of a control this small is already
              // read as one of a set, and a bar inside it is clutter.
              isActive && SELECTED_SURFACE,
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

/**
 * How a chosen thing is marked, without the accent taking over the page.
 *
 * The accent used to fill the whole row. It is the same brightness in both
 * themes while the page behind it inverts, so one token was a 1.1x step from
 * its surroundings in light and a 16.7x step in dark -- a colour in one and a
 * light source in the other, which is why it read as too much to some people
 * and not to others.
 *
 * Filled sparingly instead: the accent stays solid on a primary action, where
 * it is small and means "press this". A chosen row is tinted with the ink
 * rather than the accent, which is what makes it behave the same in both
 * themes -- the ink is dark on a light page and bright on a dark one, so the
 * row moves away from its surroundings either way, measured at 1.14x and
 * 1.29x, instead of 1.15x in one and 16.71x in the other.
 *
 * The `/10` is not a free choice: an opacity on a nested shade has to be one
 * the theme defines, and an off-scale `/12` is not generated at all.
 */
const SELECTED_SURFACE = "bg-primary-ink/10 text-primary-ink hover:bg-primary-ink/10 hover:text-primary-ink";

/**
 * The solid accent, kept but spent on a sliver.
 *
 * Drawn as a pseudo-element so that marking a row does not move its contents,
 * and inset from the ends so it reads as a marker rather than as a border.
 */
const SELECTED_MARKER = "relative before:absolute before:inset-y-1.5 before:left-0 before:w-0.5"
  + " before:rounded-full before:bg-primary";

export function AppLayout() {
  const storage = typeof window === "undefined" ? undefined : window.localStorage;
  const [chosen, setChosenState] = useState<boolean | undefined>(() => readStoredSidebarChoice(storage));

  function setChosen(collapsed: boolean) {
    setChosenState(collapsed);
    storeSidebarChoice(storage, collapsed);

  }

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
                    isActive && cn(SELECTED_SURFACE, SELECTED_MARKER),
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
      {/* The middle row is `auto` so that it takes no height at all on a
          deployment with nothing to report, which is most of them. */}
      <div className="grid min-h-0 min-w-0 grid-rows-[56px_auto_minmax(0,1fr)]">
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
        <BootstrapCredentialsBanner />
        <main className="min-h-0 overflow-hidden p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
