import { Button } from "../../components/ui/button";
import { PublishProgress } from "./publish-progress";
import type { PublishStep, UploadProgress } from "./publish-progress-model";

/**
 * What the publish panel shows once there is a publish to show.
 *
 * The same panel through all of it: the steps stay where they were while they
 * complete, so finishing is the last of them ticking rather than the panel
 * becoming a different thing. What changes is the button, which is the only
 * part whose meaning changes -- there is nothing to wait for any more.
 */
export function PublishArtifactProgress({
  filename,
  size,
  steps,
  upload,
  published,
  onClose,
}: {
  filename: string;
  size?: number;
  steps: PublishStep[];
  upload?: UploadProgress;
  published: boolean;
  onClose: () => void;
}) {
  const failed = steps.some((step) => step.state === "failed");

  return (
    <div className="grid gap-4">
      <div className="grid gap-1 rounded-md border border-border bg-background/40 p-3">
        <div className="text-xs font-medium uppercase text-muted-foreground">
          {published ? "Published" : failed ? "Not published" : "Publishing"}
        </div>
        <div className="break-words text-sm font-medium text-foreground">{filename}</div>
        {size !== undefined && (
          <div className="text-xs text-muted-foreground">{size.toLocaleString()} bytes</div>
        )}
      </div>

      <PublishProgress steps={steps} {...(upload ? { upload } : {})} />

      <div className="flex justify-end">
        {/* Nothing to wait for once it has stopped, either way. While it runs
            there is nothing this could do: the requests are already out. */}
        <Button type="button" variant={published ? "default" : "outline"} onClick={onClose} disabled={!published && !failed}>
          {published ? "Done" : failed ? "Close" : "Publishing..."}
        </Button>
      </div>
    </div>
  );
}
