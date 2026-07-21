import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";

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
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ title = "Request failed", error }: { title?: string; error: unknown }) {
  return (
    <Alert className="border-red-200 bg-red-50">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error instanceof Error ? error.message : "Unexpected error"}</AlertDescription>
    </Alert>
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
