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
    expect(assets).not.toHaveProperty("faviconDataUrl");
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
    expect(assets.inlineSvg).toContain("Example");
  });

  it("resolves a plugin-owned official SVG into trusted assets", () => {
    const icon: PluginIconManifest = {
      title: "Official",
      accentColor: "#123456",
      svg: [
        "<?xml version=\"1.0\"?>",
        "<!DOCTYPE svg [<!ENTITY ns_svg \"http://www.w3.org/2000/svg\">]>",
        "<svg width=\"20\" height=\"10\" viewBox=\"0 0 20 10\" xmlns=\"&ns_svg;\">",
        "<metadata>source metadata</metadata>",
        "<path d=\"M1 1h18v8H1z\" fill=\"#123456\"/>",
        "</svg>",
      ].join(""),
      svgSource: {
        name: "Official test logo",
        url: "https://example.test/logo.svg",
        rights: "Test rights",
      },
    };

    const assets = resolvePluginIconAssets(icon);

    expect(assets.inlineSvg).toContain("aria-hidden=\"true\"");
    expect(assets.inlineSvg).toContain("<title>Official</title>");
    expect(assets.inlineSvg).toContain("viewBox=\"0 0 20 10\"");
    expect(assets.inlineSvg).toContain("M1 1h18v8H1z");
    expect(assets.inlineSvg).not.toContain("<?xml");
    expect(assets.inlineSvg).not.toContain("<!DOCTYPE");
    expect(assets.inlineSvg).not.toContain("<metadata>");
    expect(assets.inlineSvg).not.toContain("&ns_");
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
