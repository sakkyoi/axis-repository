import { describe, expect, it } from "vitest";
import { md5Hex } from "./md5";

describe("md5Hex", () => {
  it("matches the RFC 1321 test suite", () => {
    // These vectors are published in RFC 1321 appendix A.5.
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
    expect(md5Hex("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"))
      .toBe("d174ab98d277d9f5a5611c2c9f419d9f");
    expect(md5Hex("1234567890".repeat(8))).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });

  it("handles inputs around the block and padding boundaries", () => {
    // 55 bytes is the largest input whose length still fits in the first
    // block; 56 forces a second block that holds only padding.
    expect(md5Hex("a".repeat(55))).toBe("ef1772b6dff9a122358552954ad0df65");
    expect(md5Hex("a".repeat(56))).toBe("3b0c8ac703f828b04c6c197006d17218");
    expect(md5Hex("a".repeat(64))).toBe("014842d480b571495a4a0363793f7367");
    expect(md5Hex("a".repeat(1000))).toBe("cabe45dcc9ae5b66ba86600cca6b8ba8");
  });

  it("hashes raw bytes, including ones that are not valid text", () => {
    expect(md5Hex(new Uint8Array([0x00, 0xff, 0x80, 0x7f]))).toBe(md5Hex(new Uint8Array([0, 255, 128, 127])));
    expect(md5Hex(new Uint8Array([0x00]))).toBe("93b885adfe0da089cdf634904fd59f71");
  });
});
