/**
 * Whether the navigation shows its labels, and who decides.
 *
 * The width below which it starts collapsed. Not a device: it is the width at
 * which the 240px the labels need stops being worth what it takes from the
 * page beside them, which on a repository page is a table already scrolling
 * sideways.
 */
export const SIDEBAR_LABELS_NEED_PX = 1024;

export const SIDEBAR_EXPANDED_PX = 240;
export const SIDEBAR_COLLAPSED_PX = 60;

const SIDEBAR_STORAGE_KEY = "axis-admin-sidebar-collapsed";

/**
 * What was chosen last time, if anything was.
 *
 * Undefined where nothing has been chosen, which is not the same as having
 * chosen to keep it open: only the first tells the screen it may still decide.
 *
 * Storage can throw -- a browser with cookies and site data blocked makes even
 * reading it an error -- and a navigation panel is not worth a blank page, so
 * both directions swallow it and fall back to deciding by width.
 */
export function readStoredSidebarChoice(storage: Pick<Storage, "getItem"> | undefined): boolean | undefined {
  if (!storage) return undefined;
  try {
    const stored = storage.getItem(SIDEBAR_STORAGE_KEY);
    return stored === "true" ? true : stored === "false" ? false : undefined;
  } catch {
    return undefined;
  }
}

export function storeSidebarChoice(
  storage: Pick<Storage, "setItem"> | undefined,
  collapsed: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  } catch {
    // The panel still works; it just forgets between visits.
  }
}

export function sidebarStartsCollapsed(viewportWidth: number): boolean {
  return viewportWidth < SIDEBAR_LABELS_NEED_PX;
}

/**
 * The screen decides until somebody does.
 *
 * A window narrow enough to collapse it is a guess about what is wanted, and a
 * good one; having been told otherwise it is not a guess worth repeating, so a
 * choice once made outlives any resizing -- and, being stored, any visit.
 */
export function sidebarCollapsed(input: { chosen?: boolean; viewportWidth: number }): boolean {
  return input.chosen ?? sidebarStartsCollapsed(input.viewportWidth);
}

export function sidebarWidthPx(collapsed: boolean): number {
  return collapsed ? SIDEBAR_COLLAPSED_PX : SIDEBAR_EXPANDED_PX;
}

/** What the control says it will do, which is the opposite of the state. */
export function sidebarToggleLabel(collapsed: boolean): string {
  return collapsed ? "Expand navigation" : "Collapse navigation";
}
