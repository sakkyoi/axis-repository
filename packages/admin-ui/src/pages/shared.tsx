import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { useErrorToast } from "../components/ui/toast";
import { toastErrorMessage } from "../components/ui/toast-model";
import { cn } from "../lib/utils";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  /** Omitted when the page has nothing to describe, as on a page that 404s. */
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    // Room for both and they sit side by side, the actions against the right
    // edge. Not enough, and the actions take a line of their own rather than
    // folding into a ragged block beside the title: they are held at their
    // natural width (`shrink-0`) so the row breaks before they do, and the
    // title gives way instead (`min-w-0`). Which happens is decided by whether
    // it fits, so a long title or another button changes it without anyone
    // choosing a width at which it should.
    //
    // A screen too narrow to hold the actions even on their own line is not
    // addressed here, and is not a header problem: at that width the tables
    // and the fixed sidebar overflow too.
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

/**
 * A failure in the place that has nothing to show because of it.
 *
 * Also raised in the corner, like every other message: the card explains why a
 * region is empty and stays as long as it is, and the message is what gets
 * noticed when the region is somewhere the eye is not.
 */
export function ErrorState({ title = "Request failed", error }: { title?: string; error: unknown }) {
  const message = toastErrorMessage(error);
  useErrorToast(title, error);

  return (
    <Alert className="border-destructive/35 bg-destructive/10 text-destructive-ink">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-destructive-ink">
        {message}
      </AlertDescription>
    </Alert>
  );
}

export function PageShell({
  title,
  description,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={cn("grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-5", className)}>
      <PageHeader title={title} {...(description ? { description } : {})} action={action} />
      <div className={cn("grid min-h-0 content-start gap-5 overflow-y-auto pr-1", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{message}</div>;
}

/**
 * What a page shows when the thing it is about does not exist.
 *
 * Distinct from an empty state, which says a place is ready and nothing has
 * been put in it yet. This says the address was wrong, so it carries a way
 * back — a page reached by a stale link or a typo otherwise strands whoever
 * followed it.
 */
export function NotFoundState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-0 place-items-center rounded-lg border border-dashed border-border bg-panel p-8">
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {action}
      </div>
    </div>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
