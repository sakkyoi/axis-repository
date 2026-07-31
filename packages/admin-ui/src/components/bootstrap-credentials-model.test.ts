import { describe, expect, it } from "vitest";
import { joinNames, leftoverBannerText, leftoverNeedsBanner } from "./bootstrap-credentials-model";

const password = { name: "AXIS_ADMIN_PASSWORD", sensitive: true, removal: "delete the secret" };
const passwordHash = { name: "AXIS_ADMIN_PASSWORD_HASH", sensitive: true, removal: "delete the secret" };
const username = { name: "AXIS_ADMIN_USERNAME", sensitive: false, removal: "edit wrangler.jsonc" };

describe("how loudly to say it", () => {
  it("interrupts every page for a password nobody removed", () => {
    expect(leftoverNeedsBanner([password])).toBe(true);
  });

  it("leaves a stale username to the page that lists it", () => {
    // It exposes nothing. A banner for this is a banner the reader learns to
    // look past, including on the day it says something else.
    expect(leftoverNeedsBanner([username])).toBe(false);
  });

  it("says nothing at all about a deployment that was cleaned up", () => {
    expect(leftoverNeedsBanner([])).toBe(false);
  });
});

describe("what the banner says", () => {
  it("names the one value that earned the interruption", () => {
    // The username is left over too, and mentioning it here spends the
    // reader's attention on the half that does not matter.
    expect(leftoverBannerText([password, username]))
      .toBe("AXIS_ADMIN_PASSWORD is still set on this deployment.");
  });

  it("reads as a sentence when there is more than one", () => {
    expect(leftoverBannerText([password, passwordHash]))
      .toBe("AXIS_ADMIN_PASSWORD and AXIS_ADMIN_PASSWORD_HASH are still set on this deployment.");
  });

  it("joins three the way a sentence does", () => {
    expect(joinNames(["a", "b", "c"])).toBe("a, b and c");
  });
});
