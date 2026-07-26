export interface RepositoryBrowserUploadOverlayInput {
  repositoryName: string;
  canPublish: boolean;
  isDraggingFiles: boolean;
}

export interface RepositoryBrowserUploadOverlay {
  tone: "default" | "muted";
  title: string;
  description: string;
}

export function repositoryBrowserUploadOverlay(
  input: RepositoryBrowserUploadOverlayInput,
): RepositoryBrowserUploadOverlay | undefined {
  if (!input.isDraggingFiles) {
    return undefined;
  }
  if (!input.canPublish) {
    return {
      tone: "muted",
      title: "Publishing is unavailable",
      description: "This repository does not support browser publishing.",
    };
  }
  return {
    tone: "default",
    title: "Drop files to publish",
    description: input.repositoryName,
  };
}

export function repositoryBrowserUploadOverlayClasses(tone: RepositoryBrowserUploadOverlay["tone"]): {
  backdrop: string;
  panel: string;
  content: string;
} {
  return {
    backdrop: "pointer-events-none fixed inset-0 z-50 bg-background/70 p-6 backdrop-blur-sm",
    panel: `grid h-full w-full place-items-center rounded-lg border border-dashed p-8 text-center shadow-lg ${
      tone === "default"
        ? "border-primary bg-panel/95 text-foreground"
        : "border-border bg-panel/95 text-muted-foreground"
    }`,
    content: "grid place-items-center gap-2",
  };
}

export function repositoryWorkspaceDropTargetClass(): string {
  return "relative grid h-full min-h-0";
}

export function filesFromFileList(files: FileList | null): File[] {
  return files ? Array.from(files) : [];
}

export function repositoryBrowserAcceptedPublishFiles(input: {
  files: File[];
  isAcceptedFile?: (file: File) => boolean;
}): {
  accepted: File[];
  rejected: File[];
} {
  if (!input.isAcceptedFile) {
    return { accepted: input.files, rejected: [] };
  }
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const file of input.files) {
    if (input.isAcceptedFile(file)) {
      accepted.push(file);
    } else {
      rejected.push(file);
    }
  }
  return { accepted, rejected };
}
