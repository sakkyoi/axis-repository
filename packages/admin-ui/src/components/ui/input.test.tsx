// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  it("hides browser number steppers", () => {
    render(<Input aria-label="Count" type="number" />);

    const input = screen.getByRole("spinbutton", { name: "Count" });
    expect(input.className).toContain("[appearance:textfield]");
    expect(input.className).toContain("[&::-webkit-inner-spin-button]:appearance-none");
    expect(input.className).toContain("[&::-webkit-outer-spin-button]:appearance-none");
  });
});
