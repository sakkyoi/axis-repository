// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AxisBrand, AxisLogoMark } from "./axis-brand";

describe("Axis brand components", () => {
  afterEach(cleanup);

  it("renders the logo mark as themeable inline SVG", () => {
    const { container } = render(<AxisLogoMark className="h-8 w-8" />);
    const svg = container.querySelector("svg");
    const paths = container.querySelectorAll("path");

    expect(svg?.getAttribute("viewBox")).toBe("0 0 210 210");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.classList.contains("h-8")).toBe(true);
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute("fill")).toBe("currentColor");
    expect(paths[1]?.getAttribute("fill")).toBe("#a3e635");
  });

  it("renders the wordmark and optional subtitle", () => {
    render(<AxisBrand subtitle="Admin Console" />);

    expect(screen.getByText("Axis Repository")).toBeDefined();
    expect(screen.getByText("Admin Console")).toBeDefined();
  });
});
