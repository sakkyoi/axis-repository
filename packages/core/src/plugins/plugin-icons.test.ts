import { describe, expect, it } from "vitest";
import {
  packagePluginIcon,
  resolvePluginIconAssets,
  type PluginIconManifest,
} from "./plugin-icons";

describe("plugin icons", () => {
  it("uses the package icon fallback when a plugin has no icon", () => {
    const assets = resolvePluginIconAssets(undefined);

    expect(assets.title).toBe("Package");
    expect(assets.inlineSvg).toContain("<svg");
    expect(assets.inlineSvg).toContain("aria-hidden=\"true\"");
    expect(assets.faviconDataUrl).toMatch(/^data:image\/svg\+xml,/);
  });

  it("resolves a plugin-owned vector descriptor into trusted assets", () => {
    const icon: PluginIconManifest = {
      title: "Example",
      viewBox: "0 0 24 24",
      accentColor: "#2563eb",
      shapes: [{ kind: "path", d: "M4 4h16v16H4z", fill: "currentColor" }],
    };

    const assets = resolvePluginIconAssets(icon);

    expect(assets.title).toBe("Example");
    expect(assets.accentColor).toBe("#2563eb");
    expect(assets.inlineSvg).toContain("viewBox=\"0 0 24 24\"");
    expect(assets.inlineSvg).toContain("M4 4h16v16H4z");
    expect(decodeURIComponent(assets.faviconDataUrl)).toContain("Example");
  });

  it("escapes text and rejects unsafe shape data", () => {
    expect(resolvePluginIconAssets({
      ...packagePluginIcon,
      title: "A < B",
    }).inlineSvg).toContain("A &lt; B");

    expect(() => resolvePluginIconAssets({
      title: "Bad",
      viewBox: "0 0 24 24",
      accentColor: "#111827",
      shapes: [{ kind: "path", d: "M0 0\" onload=\"alert(1)", fill: "currentColor" }],
    })).toThrow("Invalid plugin icon path data");
  });
});
