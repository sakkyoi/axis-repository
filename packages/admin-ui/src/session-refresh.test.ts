import { describe, expect, it } from "vitest";
import { accessTokenRefreshDelayMs, createSingleFlight } from "./session-refresh";

describe("createSingleFlight", () => {
  it("shares one in-flight call between concurrent callers", async () => {
    let started = 0;
    let release: (value: string) => void = () => {};
    const singleFlight = createSingleFlight<string>();
    const run = () => {
      started += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };

    const first = singleFlight(run);
    const second = singleFlight(run);
    const third = singleFlight(run);
    release("token-1");

    // Refreshing rotates the cookie, so a second concurrent refresh would
    // present a token the first already replaced.
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      "token-1",
      "token-1",
      "token-1",
    ]);
    expect(started).toBe(1);
  });

  it("starts a new call once the previous one settles", async () => {
    let started = 0;
    const singleFlight = createSingleFlight<number>();
    const run = async () => {
      started += 1;
      return started;
    };

    await expect(singleFlight(run)).resolves.toBe(1);
    await expect(singleFlight(run)).resolves.toBe(2);
    expect(started).toBe(2);
  });

  it("releases the slot after a rejection", async () => {
    let started = 0;
    const singleFlight = createSingleFlight<string>();

    await expect(singleFlight(async () => {
      started += 1;
      throw new Error("refresh failed");
    })).rejects.toThrow("refresh failed");
    await expect(singleFlight(async () => {
      started += 1;
      return "recovered";
    })).resolves.toBe("recovered");
    expect(started).toBe(2);
  });

  it("rejects rather than throwing when the call throws synchronously", async () => {
    const singleFlight = createSingleFlight<string>();

    await expect(singleFlight(() => {
      throw new Error("bad wiring");
    })).rejects.toThrow("bad wiring");
    await expect(singleFlight(async () => "recovered")).resolves.toBe("recovered");
  });
});

describe("accessTokenRefreshDelayMs", () => {
  const now = Date.parse("2026-07-26T00:00:00.000Z");

  it("schedules a refresh one minute before expiry", () => {
    expect(accessTokenRefreshDelayMs("2026-07-26T00:15:00.000Z", now)).toBe(14 * 60_000);
  });

  it("refreshes immediately when expiry is already inside the skew window", () => {
    expect(accessTokenRefreshDelayMs("2026-07-26T00:00:30.000Z", now)).toBe(0);
    expect(accessTokenRefreshDelayMs("2025-01-01T00:00:00.000Z", now)).toBe(0);
  });

  it("gives up on an unparseable expiry so the caller falls back to 401 handling", () => {
    expect(accessTokenRefreshDelayMs("", now)).toBeUndefined();
    expect(accessTokenRefreshDelayMs("not-a-date", now)).toBeUndefined();
  });
});
