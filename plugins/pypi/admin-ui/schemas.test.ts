import { describe, expect, it } from "vitest";
import { pypiClientInfoSchema, pypiProjectSchema, pypiProxyCachePurgeSchema, pypiProxyCacheSchema } from "./schemas";

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

describe("PyPI project file schema", () => {
  it("keeps a yank with no reason distinct from no yank at all", () => {
    // The empty string is a yank; dropping it would silently unyank the file
    // in whatever the UI shows.
    const parsed = pypiProjectSchema.parse({
      project: {
        name: "alpha",
        files: [
          { filename: "a-1.0.tar.gz", sha256: "a".repeat(64), yanked: "" },
          { filename: "a-2.0.tar.gz", sha256: "b".repeat(64) },
        ],
      },
    });

    expect(parsed.project.files[0]?.yanked).toBe("");
    expect(parsed.project.files[1]?.yanked).toBeUndefined();
  });

  it("carries the optional index fields when present", () => {
    const parsed = pypiProjectSchema.parse({
      project: {
        name: "alpha",
        files: [{
          filename: "a-1.0-py3-none-any.whl",
          sha256: "a".repeat(64),
          requiresPython: ">=3.9",
          coreMetadataSha256: "c".repeat(64),
        }],
      },
    });

    expect(parsed.project.files[0]).toMatchObject({
      requiresPython: ">=3.9",
      coreMetadataSha256: "c".repeat(64),
    });
  });
});

describe("PyPI proxy cache schemas", () => {
  it("parses byte cache stats and purge results", () => {
    expect(pypiProxyCacheSchema.parse({
      cache: { fileCount: 2, byteCount: 18 },
    }).cache).toEqual({ fileCount: 2, byteCount: 18 });
    expect(pypiProxyCachePurgeSchema.parse({
      purged: { objectCount: 3, byteCount: 18 },
      cache: { fileCount: 0, byteCount: 0 },
    }).purged).toEqual({ objectCount: 3, byteCount: 18 });
  });
});
