import { describe, expect, it } from "vitest";
import { installInstructionsSchema } from "./schemas";

describe("APT UI plugin schemas", () => {
  it("parses APT install instructions", () => {
    const instructions = installInstructionsSchema.parse({
      repository: "debian-internal",
      visibility: "private",
      keyUrl: "https://axis.example/repositories/debian-internal/apt/key.gpg",
      keyringPath: "/usr/share/keyrings/axis-debian-internal.gpg",
      sourceListPath: "/etc/apt/sources.list.d/axis-debian-internal.list",
      sourceLine:
        "deb [signed-by=/usr/share/keyrings/axis-debian-internal.gpg] https://axis.example/repositories/debian-internal noble main",
      authConfPath: "/etc/apt/auth.conf.d/axis-debian-internal.conf",
      authConfTemplate: "machine axis.example\nlogin axis\npassword <READ_TOKEN>\n",
      script: "# Configure credentials for private repository access.\nsudo apt update",
      commands: ["sudo apt update"],
    });

    expect(instructions.sourceLine).toContain("noble main");
    expect(instructions.authConfTemplate).toContain("<READ_TOKEN>");
  });
});
