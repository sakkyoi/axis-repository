import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import PreviewBanner from "./PreviewBanner.astro";

describe("PreviewBanner", () => {
  it("renders the version when variant is preview", async () => {
    const container = await AstroContainer.create();
    const result = await container.renderToString(PreviewBanner, {
      props: { variant: "preview", version: "abc1234" },
    });

    expect(result).toContain("abc1234");
    expect(result).toContain("Preview build");
  });

  it("renders nothing when variant is production", async () => {
    const container = await AstroContainer.create();
    const result = await container.renderToString(PreviewBanner, {
      props: { variant: "production", version: "v1.3.0" },
    });

    expect(result.trim()).toBe("");
  });

  it("renders nothing when variant and version are undefined", async () => {
    const container = await AstroContainer.create();
    const result = await container.renderToString(PreviewBanner, {
      props: { variant: undefined, version: undefined },
    });

    expect(result.trim()).toBe("");
  });
});
