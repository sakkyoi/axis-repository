import { useEffect, useState } from "react";
import { AxisLogoMark } from "./brand/axis-brand";

/**
 * How long a start is allowed to take before it is worth mentioning.
 *
 * Restoring a session is usually one quick request, and something drawn and
 * removed inside a tenth of a second reads as a flicker rather than as
 * progress. Waiting first means a fast start shows nothing at all, which is
 * what a fast start should look like.
 */
export const BOOT_NOTICE_DELAY_MS = 150;

export function useDelayedFlag(delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timeout);
  }, [delayMs]);

  return elapsed;
}

/**
 * What the console shows before it knows who is looking at it.
 *
 * Deliberately not the shape of the console: at this point the session has not
 * been restored, so whether this becomes the admin pages or the sign-in form
 * is not yet known, and a skeleton of one of them would be a guess drawn at
 * full size. The mark says which application is starting and claims nothing
 * else.
 */
export function AppBootScreen() {
  const show = useDelayedFlag(BOOT_NOTICE_DELAY_MS);

  return (
    <main
      className="grid min-h-screen place-items-center bg-background"
      role="status"
      aria-busy="true"
      aria-label="Starting"
    >
      {show && (
        <div className="grid justify-items-center gap-3 motion-safe:animate-pulse">
          <AxisLogoMark className="h-10 w-10" />
          <span className="text-sm text-muted-foreground">Axis Repository</span>
        </div>
      )}
    </main>
  );
}
