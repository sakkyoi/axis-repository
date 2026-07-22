import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorState } from "./shared";

describe("ErrorState", () => {
  it("renders string errors as their message", () => {
    expect(renderToStaticMarkup(<ErrorState error="Form could not be reset" />)).toContain(
      "Form could not be reset",
    );
  });
});
