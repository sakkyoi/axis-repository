import { describe, expect, it } from "vitest";
import {
  formatBootstrapWarningLog,
  leftoverBootstrapCredentials,
  leftoverBootstrapWarning,
} from "./bootstrap-credentials";

describe("bootstrap credentials a deployment is still carrying", () => {
  it("names the environment variable an operator has to go and find", () => {
    // "password" is what the auth service knows; it is not what anyone deletes.
    expect(leftoverBootstrapCredentials(["password"])).toEqual([
      expect.objectContaining({ name: "AXIS_ADMIN_PASSWORD" }),
    ]);
  });

  it("puts the one that matters for security first", () => {
    // Both are reported together, and an operator reading down a list acts on
    // what is at the top of it.
    const named = leftoverBootstrapCredentials(["username", "password"]).map((one) => one.name);

    expect(named).toEqual(["AXIS_ADMIN_PASSWORD", "AXIS_ADMIN_USERNAME"]);
  });

  it("sends each one to the place it is actually declared", () => {
    // The password is a secret and the username is a plain variable, so the
    // dashboard removes one of them for good and the other only until the next
    // deploy puts it back.
    const [password, username] = leftoverBootstrapCredentials(["username", "password"]);

    expect(password?.command).toBe("wrangler secret delete AXIS_ADMIN_PASSWORD");
    expect(username?.removal).toContain("wrangler.jsonc");
  });

  it("gives the username both ways, having no way to tell which was used", () => {
    // It is a plain variable now and was a secret before, and `env` reads the
    // same either way -- so offering only one of them sends half of all
    // deployments somewhere the value is not.
    const [username] = leftoverBootstrapCredentials(["username"]);

    expect(username?.command).toContain("wrangler deploy");
    expect(username?.command).toContain("wrangler secret delete AXIS_ADMIN_USERNAME");
  });

  it("offers something to run for every one of them", () => {
    // A row that only describes where to go is a row an operator has to
    // translate before they can act on it.
    for (const credential of leftoverBootstrapCredentials(["username", "password", "passwordHash"])) {
      expect(credential.command.trim()).not.toBe("");
    }
  });

  it("treats a precomputed hash as a credential as well", () => {
    // It cannot be read at a glance, but it is still the account's, and still
    // never read again.
    expect(leftoverBootstrapCredentials(["passwordHash"])).toEqual([
      expect.objectContaining({ name: "AXIS_ADMIN_PASSWORD_HASH", sensitive: true }),
    ]);
  });

  it("says nothing when a deployment is clean", () => {
    expect(leftoverBootstrapCredentials([])).toEqual([]);
    expect(leftoverBootstrapWarning([])).toBeUndefined();
  });

  it("warns that a leftover username is only redundant", () => {
    // Overstating it teaches an operator to discount the next warning.
    const warning = leftoverBootstrapWarning(leftoverBootstrapCredentials(["username"]));

    expect(warning).toContain("AXIS_ADMIN_USERNAME");
    expect(warning).toContain("no longer read");
    expect(warning).not.toContain("still readable");
  });

  it("warns that a leftover password is more than untidiness", () => {
    const warning = leftoverBootstrapWarning(leftoverBootstrapCredentials(["username", "password"]));

    expect(warning).toContain("AXIS_ADMIN_PASSWORD");
    expect(warning).toContain("still readable");
  });

  it("formats the worker log warning as a visible block", () => {
    const warning = leftoverBootstrapWarning(leftoverBootstrapCredentials(["username", "password"]));

    const log = formatBootstrapWarningLog(warning!);

    expect(log).toContain("[warn] ⚠ Bootstrap credentials left");
    expect(log).toContain("AXIS_ADMIN_PASSWORD");
    expect(log).toContain("AXIS_ADMIN_USERNAME");
    expect(log.split("\n").at(1)?.startsWith("       ")).toBe(true);
  });
});
