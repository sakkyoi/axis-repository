import { describe, expect, it } from "vitest";
import { parsePypiProxyRepositoryConfig } from "./config";

describe("PyPI repository config", () => {
  it("parses and normalizes a proxy upstream URL", () => {
    expect(parsePypiProxyRepositoryConfig({
      pypi: {
        upstreamUrl: "https://pypi.example/root",
        upstreamUrlMode: "base-url",
      },
    })).toEqual({
      upstreamUrl: "https://pypi.example/root/",
      upstreamUrlMode: "base-url",
    });
  });

  it("defaults schemeless proxy upstream URLs to https", () => {
    expect(parsePypiProxyRepositoryConfig({
      pypi: {
        upstreamUrl: "pypi.example/root",
        upstreamUrlMode: "base-url",
      },
    })).toEqual({
      upstreamUrl: "https://pypi.example/root/",
      upstreamUrlMode: "base-url",
    });
  });

  it("accepts a proxy upstream Simple API root URL mode", () => {
    expect(parsePypiProxyRepositoryConfig({
      pypi: {
        upstreamUrl: "https://pypi.nvidia.com",
        upstreamUrlMode: "simple-api-root",
      },
    })).toEqual({
      upstreamUrl: "https://pypi.nvidia.com/",
      upstreamUrlMode: "simple-api-root",
    });
  });

  it("accepts repository-scoped proxy policy overrides", () => {
    expect(parsePypiProxyRepositoryConfig({
      pypi: {
        upstreamUrl: "https://pypi.example/root",
        upstreamUrlMode: "base-url",
        proxyPolicy: {
          upstreamFetchTimeoutMs: 5000,
          fileByteCache: { enabled: false },
        },
      },
    })).toEqual({
      upstreamUrl: "https://pypi.example/root/",
      upstreamUrlMode: "base-url",
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
        upstreamUrlMode: "base-url",
      },
    })).toThrow("config.pypi.upstreamUrl must use http or https");
  });

  it("requires a proxy upstream URL mode", () => {
    expect(() => parsePypiProxyRepositoryConfig({
      pypi: {
        upstreamUrl: "https://pypi.example/",
      },
    })).toThrow("config.pypi.upstreamUrlMode is required");
  });

  it("rejects unknown proxy upstream URL modes", () => {
    expect(() => parsePypiProxyRepositoryConfig({
      pypi: {
        upstreamUrl: "https://pypi.example/",
        upstreamUrlMode: "heuristic",
      },
    })).toThrow("config.pypi.upstreamUrlMode must be base-url or simple-api-root");
  });
});
