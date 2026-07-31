/**
 * A panel that comes in from the side, or up from the bottom of a phone.
 *
 * The one place in this console where a single thing is read without leaving
 * the list it came from. Wide enough and it is a column against the right
 * edge; narrow enough and it is a sheet from the bottom, because a fixed
 * column on a 380px screen is the whole screen with its corners in the wrong
 * places.
 *
 * The width is set by the widest thing any of these hold, which is a shell
 * command meant to be copied: narrower, and the paths break mid-word into
 * something nobody can read back. It stays short of a modal, because the list
 * it came from should still be visible behind it.
 *
 * The width comes in as a whole class name rather than a number to put in one.
 * Tailwind generates what it finds written in the source, so a class assembled
 * from parts at runtime is a class that was never generated -- which shows up
 * as a drawer taking the whole screen, the width having quietly done nothing.
 */
const SIDE_DRAWER_BASE = "content-start grid-rows-[auto_minmax(0,1fr)] bottom-0 left-0 top-auto"
  + " max-h-[88dvh] w-full translate-x-0 translate-y-0 overflow-hidden rounded-b-none"
  + " sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-dvh sm:max-h-none sm:translate-x-0"
  + " sm:translate-y-0 sm:rounded-l-lg sm:rounded-r-none";

export function sideDrawerContentClass(widthClass = "sm:w-[min(92vw,560px)]"): string {
  return `${SIDE_DRAWER_BASE} ${widthClass}`;
}

export function sideDrawerBodyClass(): string {
  return "min-h-0 overflow-y-auto pr-1";
}
