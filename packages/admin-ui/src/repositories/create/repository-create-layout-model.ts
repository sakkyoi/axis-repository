export function repositoryCreatePageClass(): string {
  return "grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-5 overflow-hidden";
}

export function repositoryCreateBodyClass(): string {
  return "grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]";
}

export function repositoryCreateStepPanelClass(): string {
  return "min-h-0 overflow-y-auto rounded-lg border border-border bg-panel p-5";
}

export function repositoryCreateSummaryPanelClass(): string {
  return "min-h-0 overflow-y-auto rounded-lg border border-border bg-panel p-4";
}

export function repositoryCreateFooterClass(): string {
  return "flex shrink-0 items-center justify-between border-t border-border bg-background/95 py-4 backdrop-blur";
}
