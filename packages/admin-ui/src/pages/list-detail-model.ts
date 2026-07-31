/**
 * Whether a list can show what is selected beside it.
 *
 * The pane wants around 380px and the list is unreadable much under 600, so
 * below this the two of them stop fitting side by side. Stacking them was the
 * old answer and a poor one: the grid gave each half the height, so the list
 * was squeezed into half a screen to make room for a pane that says nothing
 * until something is picked -- and picking something changed the half of the
 * screen you were not looking at.
 */
export const DETAIL_PANE_NEEDS_PX = 1280;

export function detailPaneFitsBeside(viewportWidth: number): boolean {
  return viewportWidth >= DETAIL_PANE_NEEDS_PX;
}

export function listDetailGridClass(beside: boolean): string {
  return beside
    ? "grid h-full min-w-0 gap-5 grid-cols-[minmax(0,1fr)_minmax(360px,420px)]"
    : "grid h-full min-w-0 gap-5";
}

/**
 * How a repository's own page divides, where there is room to divide it.
 *
 * The column on the right holds what is true of the repository whatever is
 * selected in it -- what it is, and how a client is pointed at it. That is why
 * it can sit beside a page whose lists open drawers without the two fighting:
 * it never shows a selection, so nothing it holds changes when one is made.
 *
 * Which sections those are is the plugin's answer, not this one's: each
 * already marks the ones that summarise the repository rather than list its
 * contents.
 */
export function workspaceAsideGridClass(beside: boolean): string {
  return beside
    ? "grid h-full min-h-0 gap-5 grid-cols-[minmax(0,1fr)_minmax(320px,380px)]"
    : "grid min-h-0 gap-5";
}

/**
 * The page body, which stops scrolling once the columns do.
 *
 * Something has to be the fixed height the columns scroll within, and if the
 * body scrolls too there is a scrollbar for the pair of them and one for each,
 * three where two will do.
 */
export function workspaceBodyClass(twoColumns: boolean): string {
  return twoColumns
    ? "grid h-full min-h-0 overflow-hidden p-4"
    : "grid h-full min-h-0 content-start gap-4 overflow-y-auto overflow-x-hidden p-4";
}

/**
 * Each column scrolls on its own where they are side by side.
 *
 * Sharing one scrollbar means reading the install command at the foot of one
 * column takes the other column off the screen, though nothing about it has
 * changed and it is what the command is about. Stacked there is only one
 * column, and it is the page that scrolls.
 */
export function workspaceColumnClass(beside: boolean): string {
  return beside
    ? "grid min-h-0 min-w-0 content-start gap-4 overflow-y-auto pr-1"
    : "grid min-w-0 content-start gap-4";
}

/**
 * A rule between the columns, where they are beside each other.
 *
 * The two pages that already divide like this get their division for free,
 * each side being a bordered card. Here both columns are inside one panel, and
 * the sections within a column are separated by rules of their own -- so with
 * nothing between the columns the eye reads across them.
 */
export function workspaceAsideColumnClass(beside: boolean): string {
  return beside
    ? "grid min-h-0 min-w-0 content-start gap-4 overflow-y-auto border-l border-border pl-5 pr-1"
    : "grid min-w-0 content-start gap-4 border-t border-border pt-4";
}

