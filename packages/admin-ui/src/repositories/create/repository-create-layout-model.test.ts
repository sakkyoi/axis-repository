import { describe, expect, it } from "vitest";
import {
  repositoryCreateBodyClass,
  repositoryCreateFooterClass,
  repositoryCreateStepPanelClass,
  repositoryCreateSummaryPanelClass,
} from "./repository-create-layout-model";

describe("repository create layout model", () => {
  it("keeps plugin-rendered wizard steps inside their own scroll container", () => {
    expect(repositoryCreateBodyClass()).toContain("min-h-0");
    expect(repositoryCreateStepPanelClass()).toContain("min-h-0");
    expect(repositoryCreateStepPanelClass()).toContain("overflow-y-auto");
    expect(repositoryCreateSummaryPanelClass()).toContain("min-h-0");
    expect(repositoryCreateSummaryPanelClass()).toContain("overflow-y-auto");
  });

  it("keeps wizard actions in a fixed footer row instead of depending on page scroll", () => {
    expect(repositoryCreateFooterClass()).toContain("shrink-0");
  });
});
