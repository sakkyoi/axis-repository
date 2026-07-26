import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { cn } from "../lib/utils";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ title = "Request failed", error }: { title?: string; error: unknown }) {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Unexpected error";

  return (
    <Alert className="border-destructive/35 bg-destructive/10 text-destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-destructive">
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
  description: string;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={cn("grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-5", className)}>
      <PageHeader title={title} description={description} action={action} />
      <div className={cn("grid min-h-0 content-start gap-5 overflow-y-auto pr-1", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{message}</div>;
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
