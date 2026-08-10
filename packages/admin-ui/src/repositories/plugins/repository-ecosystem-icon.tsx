import { Package } from "lucide-react";
import type { RepositoryPlugin } from "../../api/schemas";
import { cn } from "../../lib/utils";

export function RepositoryEcosystemLabel({
  ecosystem,
  plugin,
  className,
}: {
  ecosystem: string;
  plugin: RepositoryPlugin | undefined;
  className?: string;
}) {
  const title = plugin?.icon?.title ?? plugin?.name ?? ecosystem;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <RepositoryEcosystemIcon ecosystem={ecosystem} plugin={plugin} />
      <span className="truncate">{title}</span>
    </span>
  );
}

export function RepositoryEcosystemIcon({
  ecosystem,
  plugin,
  className,
}: {
  ecosystem: string;
  plugin: RepositoryPlugin | undefined;
  className?: string;
}) {
  if (!plugin?.icon) {
    return (
      <span
        aria-hidden="true"
        className={cn("grid h-5 w-5 shrink-0 place-items-center rounded border border-border text-muted-foreground", className)}
        title={ecosystem}
      >
        <Package className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn("grid h-5 w-5 shrink-0 place-items-center text-primary [&_svg]:h-4 [&_svg]:w-4", className)}
      dangerouslySetInnerHTML={{ __html: plugin.icon.inlineSvg }}
    />
  );
}
