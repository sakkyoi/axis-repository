import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Skeleton, SkeletonRows, SkeletonText } from "./skeleton";

describe("skeleton", () => {
  afterEach(cleanup);

  it("stands where the content will be, in the shape it will have", () => {
    // The point is the shape: a placeholder the size of what is coming stops
    // the page rearranging itself under the reader when it arrives.
    const { container } = render(<SkeletonRows rows={3} columns={["w-48", "w-20"]} />);

    const rows = [...container.firstElementChild!.children];
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.children.length === 2)).toBe(true);
    expect(container.querySelector(".w-48")).toBeTruthy();
    expect(container.querySelector(".w-20")).toBeTruthy();
  });

  it("says it is loading, to anyone who cannot see it", () => {
    render(<SkeletonRows rows={2} columns={["w-24"]} />);

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.getAttribute("aria-label")).toBe("Loading");
  });

  it("keeps its own blocks out of the reading", () => {
    // Each block is decoration around the one announcement above it; read out
    // individually they would be a screenful of nothing.
    const { container } = render(<Skeleton className="h-4 w-24" />);

    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("ends a paragraph short, as a paragraph ends", () => {
    const { container } = render(<SkeletonText lines={3} />);

    const lines = [...container.firstElementChild!.children];
    expect(lines).toHaveLength(3);
    expect(lines[0]?.className).toContain("w-full");
    expect(lines[2]?.className).toContain("w-2/5");
  });
});
