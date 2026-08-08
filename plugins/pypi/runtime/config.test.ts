import { describe, expect, it } from "vitest";
import { parsePypiProxyRepositoryConfig } from "./config";

describe("PyPI repository config", () => {
  it("parses and normalizes a proxy upstream URL", () => {
    expect(parsePypiProxyRepositoryConfig({
      pypi: {
        upstreamUrl: "https://pypi.example/root",
      },
    })).toEqual({
      upstreamUrl: "https://pypi.example/root/",
    });
  });

  it("accepts repository-scoped proxy policy overrides", () => {
    expect(parsePypiProxyRepositoryConfig({
      pypi: {
        upstreamUrl: "https://pypi.example/root",
        proxyPolicy: {
          upstreamFetchTimeoutMs: 5000,
          fileByteCache: { enabled: false },
        },
      },
    })).toEqual({
      upstreamUrl: "https://pypi.example/root/",
      proxyPolicy: {
        upstreamFetchTimeoutMs: 5000,
        fileByteCache: { enabled: false },
      },
    });
  });

  it("requires a proxy upstream URL", () => {
    expect(() => parsePypiProxyRepositoryConfig({ pypi: {} }))
      .toThrow("config.pypi.upstreamUrl is required");
  });

  it("rejects non-http proxy upstream URLs", () => {
    expect(() => parsePypiProxyRepositoryConfig({
      pypi: {
        upstreamUrl: "file:///tmp/simple",
      },
    })).toThrow("config.pypi.upstreamUrl must use http or https");
  });
});
