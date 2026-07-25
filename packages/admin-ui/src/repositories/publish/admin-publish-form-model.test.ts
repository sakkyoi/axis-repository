import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "./admin-publish-form-model";

describe("admin publish form model", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("computes sha256 hex for uploaded bytes", async () => {
    expect(await sha256Hex(new Blob([new Uint8Array([1, 2, 3])]))).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });

  it("computes sha256 hex when WebCrypto subtle digest is unavailable", async () => {
    vi.stubGlobal("crypto", {});

    expect(await sha256Hex(new Blob([new Uint8Array([1, 2, 3])]))).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });
});
