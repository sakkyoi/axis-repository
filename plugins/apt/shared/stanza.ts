/**
 * Debian control ("deb822") stanza parsing and formatting.
 *
 * A field value may span several lines: every line after the first begins with
 * a space or tab, and a line holding only " ." encodes a blank line. Both the
 * `.deb` control file and the `Packages` index use this format, and the long
 * form of `Description` depends on it, so values keep their continuation lines
 * verbatim rather than being folded into one line.
 */

export class DebControlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebControlParseError";
  }
}

export interface DebianStanzaField {
  name: string;
  value: string;
}

export type DebianStanza = DebianStanzaField[];

/** Splits text into stanzas, which are separated by one or more blank lines. */
export function parseStanzas(text: string): DebianStanza[] {
  const stanzas: DebianStanza[] = [];
  let current: DebianStanza = [];

  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    if (rawLine.trim() === "" && !/^[ \t]/.test(rawLine)) {
      if (current.length > 0) {
        stanzas.push(current);
        current = [];
      }
      continue;
    }

    if (/^[ \t]/.test(rawLine)) {
      const field = current[current.length - 1];
      if (!field) {
        throw new DebControlParseError("Debian control metadata starts with a continuation line");
      }
      field.value = `${field.value}\n${rawLine.replace(/\s+$/, "")}`;
      continue;
    }

    const separator = rawLine.indexOf(":");
    if (separator <= 0) {
      throw new DebControlParseError("Debian control metadata is invalid");
    }
    current.push({ name: rawLine.slice(0, separator), value: rawLine.slice(separator + 1).trim() });
  }

  if (current.length > 0) {
    stanzas.push(current);
  }
  return stanzas;
}

/** Parses exactly one stanza, which is what a `.deb` control file holds. */
export function parseStanza(text: string): DebianStanza {
  const stanzas = parseStanzas(text);
  const first = stanzas[0];
  if (!first) {
    throw new DebControlParseError("Debian control metadata is empty");
  }
  return first;
}

export function formatStanza(stanza: DebianStanza): string {
  return `${stanza.map((field) => formatField(field)).join("\n")}\n`;
}

/**
 * A value that begins on its own line keeps the field name bare.
 *
 * `Files:` and `Package-List:` are written that way — the name, then every
 * entry on an indented line of its own. Emitting the usual space after the
 * colon would put the first entry on the name's line with two spaces in front
 * of it, which is not how any Debian tool writes them.
 */
function formatField(field: DebianStanzaField): string {
  return field.value.startsWith("\n")
    ? `${field.name}:${field.value}`
    : `${field.name}: ${field.value}`;
}

export function stanzaField(stanza: DebianStanza, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return stanza.find((field) => field.name.toLowerCase() === wanted)?.value;
}

/**
 * Collapses a multi-line value onto one line, for the places that need a
 * single-line summary rather than the value as published.
 */
export function foldStanzaValue(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => (line === "." ? "" : line))
    .join(" ")
    .trim();
}
