import { Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";

export interface HelpTriggerProps {
  label: string;
  children: React.ReactNode;
  variant?: "tooltip" | "dialog";
  title?: string;
}

export function HelpTrigger({
  label,
  children,
  variant = "tooltip",
  title,
}: HelpTriggerProps) {
  if (variant === "dialog") {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <HelpIconButton label={label} />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title ?? label}</DialogTitle>
            <DialogDescription asChild>
              <div>{children}</div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const descriptionId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-description`;

  return (
    <span className="group relative inline-flex">
      <HelpIconButton label={label} describedBy={descriptionId} />
      <span
        id={descriptionId}
        className="pointer-events-none absolute left-1/2 top-7 z-20 hidden w-72 -translate-x-1/2 rounded-md border border-border bg-panel px-3 py-2 text-xs font-normal text-panel-foreground shadow-lg group-focus-within:block group-hover:block"
      >
        {children}
      </span>
    </span>
  );
}

function HelpIconButton({ label, describedBy }: { label: string; describedBy?: string }) {
  return (
    <button
      type="button"
      className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={label}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
    >
      <Info className="size-4" aria-hidden="true" />
    </button>
  );
}
