import { AlertCircle, Check, Circle, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  uploadFileLabel,
  uploadPercent,
  type PublishStep,
  type PublishStepState,
  type UploadProgress,
} from "./publish-progress-model";

const stepIcons: Record<PublishStepState, typeof Check> = {
  done: Check,
  active: Loader2,
  failed: AlertCircle,
  pending: Circle,
};

const stepClasses: Record<PublishStepState, string> = {
  done: "text-muted-foreground",
  active: "text-foreground",
  failed: "text-destructive-ink",
  pending: "text-muted-foreground/50",
};

/**
 * What a publish is doing, and what it already did.
 *
 * A publish is four requests, and the one line of text it used to report said
 * only which of them was running. When one fails that line is gone, replaced
 * by a message that says what went wrong but not where -- and where is what
 * tells you whether the artifact reached storage.
 *
 * The upload carries a bar because it is the only step whose length anyone can
 * feel: the others are a round trip each, and a bar for them would be an
 * animation pretending to be a measurement.
 */
export function PublishProgress({
  steps,
  upload,
  className,
}: {
  steps: PublishStep[];
  upload?: UploadProgress;
  className?: string;
}) {
  const percent = uploadPercent(upload);
  const fileLabel = uploadFileLabel(upload);

  return (
    <ol className={cn("grid gap-3", className)} aria-label="Publish progress">
      {steps.map((step) => {
        const Icon = stepIcons[step.state];
        return (
          <li key={step.id} className={cn("grid gap-1.5 text-sm", stepClasses[step.state])}>
            <div className="flex items-center gap-2">
              <Icon
                aria-hidden="true"
                className={cn("h-4 w-4 shrink-0", step.state === "active" && "animate-spin")}
              />
              <span className={cn(step.state === "active" && "font-medium")}>{step.label}</span>
              {step.id === "upload" && step.state === "active" && fileLabel && (
                <span className="ml-auto text-xs text-muted-foreground">{fileLabel}</span>
              )}
              {step.id === "upload" && step.state === "active" && percent !== undefined && (
                <span className="ml-auto tabular-nums text-xs text-muted-foreground">{percent}%</span>
              )}
            </div>
            {step.id === "upload" && step.state === "active" && (
              <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  // Unknown length is shown as an empty track rather than a
                  // full one: a bar that cannot measure must not look finished.
                  className={cn("h-full rounded-full bg-primary transition-[width] duration-200")}
                  style={{ width: `${percent ?? 0}%` }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
