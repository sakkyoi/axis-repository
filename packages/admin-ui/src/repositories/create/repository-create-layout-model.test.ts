import { describe, expect, it } from "vitest";
import {
  repositoryCreateBodyClass,
  repositoryCreateFooterClass,
  repositoryCreatePageClass,
  repositoryCreateStepPanelClass,
  repositoryCreateSummaryPanelClass,
} from "./repository-create-layout-model";

describe("repository create layout model", () => {
  it("keeps plugin-rendered wizard steps inside their own scroll container", () => {
    expect(repositoryCreatePageClass()).toContain("h-full");
    expect(repositoryCreatePageClass()).toContain("min-h-0");
    expect(repositoryCreatePageClass()).toContain("overflow-hidden");
    expect(repositoryCreateBodyClass()).toContain("min-h-0");
    expect(repositoryCreateStepPanelClass()).toContain("min-h-0");
    expect(repositoryCreateStepPanelClass()).toContain("overflow-y-auto");
    expect(repositoryCreateSummaryPanelClass()).toContain("min-h-0");
    expect(repositoryCreateSummaryPanelClass()).toContain("overflow-y-auto");
  });

  it("keeps wizard actions in a fixed footer row instead of depending on page scroll", () => {
    expect(repositoryCreatePageClass()).toContain("grid-rows-[auto_auto_minmax(0,1fr)_auto]");
    expect(repositoryCreateFooterClass()).toContain("shrink-0");
  });
});
