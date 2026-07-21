import { describe, expect, it } from "vitest";
import {
  authConfPathForRepository,
  buildAptInstallInfo,
  buildAptSourceInfo,
  keyringPathForRepository,
  sourceListPathForRepository,
} from "./apt-client";

const repository = {
  name: "debian-public",
  visibility: "public" as const,
  codename: "noble",
  components: ["main", "contrib"],
};

describe("APT client helpers", () => {
  it("builds stable local apt file paths from repository names", () => {
    expect(keyringPathForRepository("debian-public")).toBe("/usr/share/keyrings/axis-debian-public.gpg");
    expect(sourceListPathForRepository("debian-public")).toBe("/etc/apt/sources.list.d/axis-debian-public.list");
    expect(authConfPathForRepository("debian-public")).toBe("/etc/apt/auth.conf.d/axis-debian-public.conf");
  });

  it("builds apt source information from request origin and repository config", () => {
    expect(buildAptSourceInfo({
      origin: "https://axis.example",
      repository,
    })).toEqual({
      repository: "debian-public",
      ecosystem: "apt",
      baseUrl: "https://axis.example/repositories/debian-public",
      codename: "noble",
      components: ["main", "contrib"],
      keyringPath: "/usr/share/keyrings/axis-debian-public.gpg",
      sourceLine:
        "deb [signed-by=/usr/share/keyrings/axis-debian-public.gpg] https://axis.example/repositories/debian-public noble main contrib",
    });
  });

  it("builds public install instructions without auth configuration", () => {
    expect(buildAptInstallInfo({
      origin: "https://axis.example",
      repository,
    })).toEqual({
      repository: "debian-public",
      visibility: "public",
      keyUrl: "https://axis.example/repositories/debian-public/apt/key.gpg",
      keyringPath: "/usr/share/keyrings/axis-debian-public.gpg",
      sourceListPath: "/etc/apt/sources.list.d/axis-debian-public.list",
      sourceLine:
        "deb [signed-by=/usr/share/keyrings/axis-debian-public.gpg] https://axis.example/repositories/debian-public noble main contrib",
      commands: [
        "curl -fsSL https://axis.example/repositories/debian-public/apt/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/axis-debian-public.gpg",
        "echo 'deb [signed-by=/usr/share/keyrings/axis-debian-public.gpg] https://axis.example/repositories/debian-public noble main contrib' | sudo tee /etc/apt/sources.list.d/axis-debian-public.list",
        "sudo apt update",
      ],
    });
  });

  it("builds private install instructions with an auth template but no token secret", () => {
    expect(buildAptInstallInfo({
      origin: "https://axis.example",
      repository: { ...repository, name: "debian-private", visibility: "private" },
    })).toMatchObject({
      repository: "debian-private",
      visibility: "private",
      authConfPath: "/etc/apt/auth.conf.d/axis-debian-private.conf",
      authConfTemplate: "machine axis.example\nlogin axis\npassword <READ_TOKEN>\n",
    });
    expect(JSON.stringify(buildAptInstallInfo({
      origin: "https://axis.example",
      repository: { ...repository, name: "debian-private", visibility: "private" },
    }))).not.toContain("axis_publish_");
  });
});
