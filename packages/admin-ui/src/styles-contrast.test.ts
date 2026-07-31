import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Whether the colours meant to be read can be.
 *
 * The accent is a light: it is drawn as a surface with dark text on top, and
 * it works beautifully that way. Set as text on a light background it measured
 * 1.15:1, which is not "a bit low" -- it is invisible, and it stayed that way
 * through review and a browser because whoever looked was in dark mode, where
 * the same token measures 15:1.
 *
 * So the check is arithmetic rather than judgement, and it is done on the two
 * themes equally. `-ink` tokens are the ones set as text; `--primary` and
 * friends stay as they are, because a surface is not read.
 */

const styles = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

function theme(selector: string): Record<string, string> {
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, (value ?? "").trim()]),
  );
}

function rgb(value: string): [number, number, number] {
  const [h, s, l] = value.replace(/%/g, "").split(/\s+/).map(Number) as [number, number, number];
  const saturation = s / 100;
  const lightness = l / 100;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return lightness - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4)];
}

function luminance(value: string): number {
  const [r, g, b] = rgb(value)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(ink: string, surface: string): number {
  const a = luminance(ink);
  const b = luminance(surface);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG AA for text at ordinary sizes. */
const READABLE = 4.5;

const THEMES = { light: theme(":root"), dark: theme(':root\\[data-theme="dark"\\]') };

/** Every surface a body of text is drawn on, and so has to be legible against. */
const SURFACES = ["background", "panel", "muted"];

describe("colours that are read rather than looked at", () => {
  for (const [name, tokens] of Object.entries(THEMES)) {
    describe(name, () => {
      it("defines an ink for each accent that is set as text", () => {
        // A missing one resolves to nothing and the text inherits, which looks
        // deliberate and is not.
        for (const ink of ["primary-ink", "success-ink", "warning-ink", "destructive-ink"]) {
          expect(tokens[ink], `${name} is missing --${ink}`).toBeDefined();
        }
      });

      for (const ink of [
        "primary-ink",
        "success-ink",
        "warning-ink",
        "destructive-ink",
        "foreground",
        "muted-foreground",
      ]) {
        for (const surface of SURFACES) {
          it(`reads --${ink} on --${surface}`, () => {
            const measured = contrast(tokens[ink] ?? "", tokens[surface] ?? "");

            expect(measured, `--${ink} on --${surface} is ${measured.toFixed(2)}:1`)
              .toBeGreaterThanOrEqual(READABLE);
          });
        }
      }
    });
  }

  it("keeps dark text on the accent where the accent is the surface", () => {
    // The other direction of the same pairing: `bg-primary text-primary-foreground`
    // is how the accent is meant to be used, and it has to survive too.
    for (const [name, tokens] of Object.entries(THEMES)) {
      for (const pair of ["primary", "success", "warning", "destructive"]) {
        const measured = contrast(tokens[`${pair}-foreground`] ?? "", tokens[pair] ?? "");

        expect(measured, `${name}: --${pair}-foreground on --${pair} is ${measured.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(READABLE);
      }
    }
  });
});
