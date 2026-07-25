import { describe, expect, it } from "vitest";
import { repositoryEmptyStatePanelClass } from "./repository-empty-state-model";

describe("repository empty state model", () => {
  it("uses one dashed panel treatment for empty repository detail sections", () => {
    const className = repositoryEmptyStatePanelClass();

    expect(className).toContain("grid");
    expect(className).toContain("min-h-[calc(16rem-1.5rem)]");
    expect(className).toContain("place-items-center");
    expect(className).toContain("border-dashed");
    expect(className).toContain("text-muted-foreground");
  });
});
