import { describe, expect, it } from "vitest";
import { pypiClientInfoSchema } from "./schemas";

describe("PyPI UI plugin schemas", () => {
  it("parses PyPI client helper information", () => {
    const info = pypiClientInfoSchema.parse({
      repository: "python-internal",
      ecosystem: "pypi",
      simpleUrl: "https://axis.example/repositories/python-internal/simple/",
      pipIndexUrl: "https://axis.example/repositories/python-internal/simple/",
    });

    expect(info.pipIndexUrl).toBe("https://axis.example/repositories/python-internal/simple/");
  });
});
