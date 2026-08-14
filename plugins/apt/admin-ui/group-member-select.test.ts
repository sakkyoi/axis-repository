import { describe, expect, it } from "vitest";
import {
  parseAptGroupMemberValue,
  serializeAptGroupMembers,
} from "./group-member-select";

describe("APT group member select", () => {
  it("parses newline and comma separated repository names", () => {
    expect(parseAptGroupMemberValue("debian-hosted\ndebian-proxy, debian-hosted"))
      .toEqual(["debian-hosted", "debian-proxy"]);
  });

  it("serializes selected members in resolution order", () => {
    expect(serializeAptGroupMembers(["debian-hosted", "debian-proxy", "debian-hosted"]))
      .toBe("debian-hosted\ndebian-proxy");
  });
});
