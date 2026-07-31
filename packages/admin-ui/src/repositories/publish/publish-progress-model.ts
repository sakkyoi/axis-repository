import type { RepositoryPublishPhase } from "./repository-publish-flow";

/**
 * The four requests a publish is made of, as something to watch.
 *
 * A single line saying what is happening cannot say what already happened, so
 * a publish that stops says only that it stopped. These are the same phases the
 * flow moves through, kept in their order, so the one that failed is the one
 * still marked as running when the rest are done.
 */
export type PublishStepId = "session" | "upload" | "verify" | "finalize";

export type PublishStepState = "pending" | "active" | "done" | "failed";

export interface PublishStep {
  id: PublishStepId;
  label: string;
  state: PublishStepState;
}

const STEPS: Array<{ id: PublishStepId; label: string; phase: RepositoryPublishPhase }> = [
  { id: "session", label: "Create publish session", phase: "preparing" },
  { id: "upload", label: "Upload artifact", phase: "uploading" },
  { id: "verify", label: "Verify upload", phase: "verifying" },
  { id: "finalize", label: "Finalize repository", phase: "finalizing" },
];

/** Where a phase sits in the order; -1 for the ones that are not a step. */
function phaseIndex(phase: RepositoryPublishPhase): number {
  return STEPS.findIndex((step) => step.phase === phase);
}

export function publishSteps(input: {
  phase: RepositoryPublishPhase;
  /**
   * The phase the failure happened in. A publish that throws is put back to
   * idle, so the phase alone can no longer say where it got to.
   */
  failedAt?: RepositoryPublishPhase;
}): PublishStep[] {
  if (input.failedAt) {
    const failed = phaseIndex(input.failedAt);
    return STEPS.map((step, index) => ({
      id: step.id,
      label: step.label,
      state: index < failed ? "done" : index === failed ? "failed" : "pending",
    }));
  }

  if (input.phase === "published") {
    return STEPS.map((step) => ({ id: step.id, label: step.label, state: "done" }));
  }

  const current = phaseIndex(input.phase);
  return STEPS.map((step, index) => ({
    id: step.id,
    label: step.label,
    state: current < 0 ? "pending" : index < current ? "done" : index === current ? "active" : "pending",
  }));
}

export interface UploadProgress {
  /** Bytes sent so far, of the file being sent. */
  loaded: number;
  /** Undefined where the browser cannot say, which a stream upload cannot. */
  total?: number;
  /** 1-based, for saying which of several files this is. */
  fileNumber: number;
  fileCount: number;
}

/** Undefined where there is no total to divide by, so the bar stays unfilled. */
export function uploadPercent(progress: UploadProgress | undefined): number | undefined {
  if (!progress?.total) {
    return undefined;
  }
  return Math.min(100, Math.round((progress.loaded / progress.total) * 100));
}

/** Only worth saying when there is more than one. */
export function uploadFileLabel(progress: UploadProgress | undefined): string | undefined {
  if (!progress || progress.fileCount < 2) {
    return undefined;
  }
  return `file ${progress.fileNumber} of ${progress.fileCount}`;
}
