import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppBootScreen } from "./app-boot";

describe("starting up", () => {
  afterEach(cleanup);

  it("says it is busy from the first moment, to anyone who cannot see it", () => {
    // The mark waits; the announcement does not, because a screen reader has
    // nothing else to go on.
    render(<AppBootScreen />);

    expect(screen.getByRole("status", { name: "Starting" }).getAttribute("aria-busy")).toBe("true");
  });

  it("draws nothing at all for the first moment", () => {
    // A start that finishes in under a tenth of a second should look like it
    // finished, not like something appeared and left.
    render(<AppBootScreen />);

    expect(screen.queryByText("Axis Repository")).toBeNull();
  });

  it("shows what is starting once it is taking a while", async () => {
    render(<AppBootScreen />);

    await waitFor(() => expect(screen.getByText("Axis Repository")).toBeTruthy());
  });
});
