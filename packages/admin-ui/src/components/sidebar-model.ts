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

export function sidebarStartsCollapsed(viewportWidth: number): boolean {
  return viewportWidth < SIDEBAR_LABELS_NEED_PX;
}

/**
 * The screen decides until somebody does.
 *
 * A window narrow enough to collapse it is a guess about what is wanted, and a
 * good one; having been told otherwise it is not a guess worth repeating, so a
 * choice once made outlives any resizing.
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
