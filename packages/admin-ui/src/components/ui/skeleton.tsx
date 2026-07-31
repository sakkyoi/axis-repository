import { cn } from "../../lib/utils";

/**
 * A stand-in for something still being fetched.
 *
 * The point is not the animation, it is the shape: a block the size of what is
 * coming says how much is coming and where it will be, so the page does not
 * rearrange itself under the reader the moment it arrives. That only works if
 * each of these is placed to match the thing it stands for, which is why they
 * are composed at the call site rather than generated.
 *
 * The sweep is a gradient moved across the block rather than a fade of the
 * whole of it: a column of fading blocks pulses as several things, and one
 * sweep passing over them reads as one thing being loaded.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative overflow-hidden rounded bg-muted/60", className)}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
    </div>
  );
}

/**
 * Rows of a table that has none yet.
 *
 * Takes the widths of the real columns so the shape matches what replaces it.
 * Announced as busy rather than hidden: something that takes long enough to
 * need a placeholder takes long enough to be worth saying out loud.
 */
export function SkeletonRows({
  rows = 3,
  columns,
  className,
}: {
  rows?: number;
  /** A width class per column, in the order the table has them. */
  columns: string[];
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 p-3", className)} role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4">
          {columns.map((width, column) => (
            <Skeleton key={column} className={cn("h-4", width)} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Lines of prose, the last one short, as a paragraph ends. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)} role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton key={line} className={cn("h-4", line === lines - 1 ? "w-2/5" : "w-full")} />
      ))}
    </div>
  );
}
