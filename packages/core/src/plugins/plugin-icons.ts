import type { PluginIconManifest, PluginIconShape, ResolvedPluginIconAssets } from "./plugin-manifests";

export type { PluginIconManifest, PluginIconShape, ResolvedPluginIconAssets } from "./plugin-manifests";

const safePathPattern = /^[MmZzLlHhVvCcSsQqTtAa0-9,.\-\s]+$/;
const safeColorPattern = /^(currentColor|none|#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6})$/;
const safeViewBoxPattern = /^-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?$/;
const unsafeSvgPattern = /<script\b|<foreignObject\b|\son[a-z]+\s*=|javascript:/i;

export const packagePluginIcon: PluginIconManifest = {
  title: "Package",
  viewBox: "0 0 24 24",
  accentColor: "#64748b",
  shapes: [
    {
      kind: "path",
      d: "M5 7.5 12 3l7 4.5v9L12 21l-7-4.5v-9Z",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
    },
    {
      kind: "path",
      d: "M5.5 7.7 12 11.5l6.5-3.8M12 11.5V20",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
    },
  ],
};

export function resolvePluginIconAssets(icon: PluginIconManifest | undefined): ResolvedPluginIconAssets {
  const normalized = normalizePluginIcon(icon ?? packagePluginIcon);
  const inlineSvg = normalized.svg === undefined
    ? renderPluginIconSvg(normalized)
    : renderOfficialIconSvg(normalized);
  return {
    title: normalized.title,
    accentColor: normalized.accentColor,
    inlineSvg,
  };
}

function normalizePluginIcon(icon: PluginIconManifest): PluginIconManifest {
  const title = icon.title.trim();
  if (!title) {
    throw new Error("Plugin icon title is required");
  }
  if (!safeColorPattern.test(icon.accentColor)) {
    throw new Error("Invalid plugin icon accent color");
  }
  if (icon.svg !== undefined) {
    if (icon.shapes !== undefined || icon.viewBox !== undefined) {
      throw new Error("Plugin icon must provide either svg or shapes");
    }
    if (unsafeSvgPattern.test(icon.svg)) {
      throw new Error("Invalid plugin icon SVG");
    }
    if (!icon.svgSource?.name.trim() || !icon.svgSource.url.trim() || !icon.svgSource.rights.trim()) {
      throw new Error("Plugin SVG icon source metadata is required");
    }
    return {
      title,
      accentColor: icon.accentColor,
      svg: icon.svg.trim(),
      svgSource: {
        name: icon.svgSource.name.trim(),
        url: icon.svgSource.url.trim(),
        rights: icon.svgSource.rights.trim(),
      },
    };
  }
  if (icon.viewBox === undefined || !safeViewBoxPattern.test(icon.viewBox)) {
    throw new Error("Invalid plugin icon viewBox");
  }
  if (icon.shapes === undefined || icon.shapes.length === 0) {
    throw new Error("Plugin icon must include at least one shape");
  }
  return {
    title,
    viewBox: icon.viewBox.trim().replace(/\s+/g, " "),
    accentColor: icon.accentColor,
    shapes: icon.shapes.map(normalizeShape),
  };
}

function normalizeShape(shape: PluginIconShape): PluginIconShape {
  if (shape.kind === "path") {
    if (!safePathPattern.test(shape.d)) {
      throw new Error("Invalid plugin icon path data");
    }
    return {
      kind: "path",
      d: shape.d.trim(),
      ...paintAttrs(shape),
    };
  }
  if (shape.kind === "circle") {
    return {
      kind: "circle",
      cx: safeNumber(shape.cx, "circle cx"),
      cy: safeNumber(shape.cy, "circle cy"),
      r: safeNumber(shape.r, "circle r"),
      ...paintAttrs(shape),
    };
  }
  return {
    kind: "rect",
    x: safeNumber(shape.x, "rect x"),
    y: safeNumber(shape.y, "rect y"),
    width: safeNumber(shape.width, "rect width"),
    height: safeNumber(shape.height, "rect height"),
    ...(shape.rx === undefined ? {} : { rx: safeNumber(shape.rx, "rect rx") }),
    ...paintAttrs(shape),
  };
}

function paintAttrs(shape: PluginIconShape) {
  const attrs: { fill?: string; stroke?: string; strokeWidth?: number } = {};
  if (shape.fill !== undefined) {
    attrs.fill = safeColor(shape.fill, "fill");
  }
  if (shape.stroke !== undefined) {
    attrs.stroke = safeColor(shape.stroke, "stroke");
  }
  if (shape.strokeWidth !== undefined) {
    attrs.strokeWidth = safeNumber(shape.strokeWidth, "stroke width");
  }
  return attrs;
}

function safeColor(color: string, label: string): string {
  if (!safeColorPattern.test(color)) {
    throw new Error(`Invalid plugin icon ${label}`);
  }
  return color;
}

function safeNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid plugin icon ${label}`);
  }
  return value;
}

function renderPluginIconSvg(icon: PluginIconManifest): string {
  const shapes = icon.shapes!.map(renderShape).join("");
  return `<svg aria-hidden="true" viewBox="${escapeHtml(icon.viewBox!)}" fill="none" xmlns="http://www.w3.org/2000/svg"><title>${escapeHtml(icon.title)}</title>${shapes}</svg>`;
}

function renderOfficialIconSvg(icon: PluginIconManifest): string {
  const withoutPreamble = icon.svg!
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?\]>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<metadata\b[\s\S]*?<\/metadata>/gi, "")
    .trim();
  const normalizedSvg = expandKnownSvgNamespaceEntities(withoutPreamble);
  const match = normalizedSvg.match(/^<svg\b([^>]*)>/i);
  if (!match) {
    throw new Error("Invalid plugin icon SVG root");
  }
  const attrs = match[1]!
    .replace(/\saria-hidden="[^"]*"/i, "")
    .replace(/\srole="[^"]*"/i, "");
  return `<svg aria-hidden="true"${attrs}><title>${escapeHtml(icon.title)}</title>${normalizedSvg.slice(match[0].length)}`;
}

function expandKnownSvgNamespaceEntities(svg: string): string {
  return svg
    .replaceAll("&ns_svg;", "http://www.w3.org/2000/svg")
    .replaceAll("&ns_xlink;", "http://www.w3.org/1999/xlink")
    .replaceAll("&ns_extend;", "http://ns.adobe.com/Extensibility/1.0/")
    .replaceAll("&ns_ai;", "http://ns.adobe.com/AdobeIllustrator/10.0/")
    .replaceAll("&ns_graphs;", "http://ns.adobe.com/Graphs/1.0/");
}

function renderShape(shape: PluginIconShape): string {
  const paint = renderPaintAttrs(shape);
  if (shape.kind === "path") {
    return `<path d="${escapeHtml(shape.d)}"${paint}/>`;
  }
  if (shape.kind === "circle") {
    return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}"${paint}/>`;
  }
  return [
    `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"`,
    shape.rx === undefined ? "" : ` rx="${shape.rx}"`,
    `${paint}/>`,
  ].join("");
}

function renderPaintAttrs(shape: PluginIconShape): string {
  return [
    shape.fill === undefined ? "" : ` fill="${escapeHtml(shape.fill)}"`,
    shape.stroke === undefined ? "" : ` stroke="${escapeHtml(shape.stroke)}"`,
    shape.strokeWidth === undefined ? "" : ` stroke-width="${shape.strokeWidth}"`,
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
