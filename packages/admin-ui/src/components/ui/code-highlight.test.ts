import { describe, expect, it } from "vitest";
import { highlightCode, type CodeToken } from "./code-highlight";

/** What was coloured, without asserting where every space landed. */
function coloured(tokens: CodeToken[], kind: CodeToken["kind"]): string[] {
  return tokens.filter((token) => token.kind === kind).map((token) => token.text.trim()).filter(Boolean);
}

function rebuilt(tokens: CodeToken[]): string {
  return tokens.map((token) => token.text).join("");
}

describe("highlighting shell", () => {
  it("gives back exactly what it was given", () => {
    // Whatever else it does, a highlighter that drops or invents a character
    // has changed a command someone is about to run.
    const source = "sudo tee /etc/apt/auth.conf.d/axis.conf <<'EOF'\nmachine example\nEOF\n";

    expect(rebuilt(highlightCode(source, "shell"))).toBe(source);
  });

  it("marks the command and nothing else on the line", () => {
    // Its flags stay plain: coloured too, a line is one stripe of the accent
    // rather than a verb with arguments after it.
    const tokens = highlightCode("curl -fsSL https://example/key.gpg | sudo gpg --dearmor", "shell");

    expect(coloured(tokens, "keyword")).toEqual(["curl", "sudo"]);
    expect(coloured(tokens, "property")).toEqual([]);
  });

  it("reads a comment to the end of its line and no further", () => {
    const tokens = highlightCode("# Install the key.\ncurl https://example", "shell");

    expect(coloured(tokens, "comment")).toEqual(["# Install the key."]);
    expect(coloured(tokens, "keyword")).toEqual(["curl"]);
  });

  it("does not take a hash inside a word for a comment", () => {
    // Fragments and anchors appear in the URLs these commands carry.
    const tokens = highlightCode("curl https://example/page#section", "shell");

    expect(coloured(tokens, "comment")).toEqual([]);
  });

  it("takes a single-quoted string whole, backslashes and all", () => {
    const tokens = highlightCode("echo 'deb [signed-by=/usr/share/k.gpg] https://example noble main'", "shell");

    expect(coloured(tokens, "string"))
      .toEqual(["'deb [signed-by=/usr/share/k.gpg] https://example noble main'"]);
  });

  it("leaves a quote that never closes as a string to the end", () => {
    // Half-written input still has to come back whole.
    const source = "echo 'unfinished";

    expect(rebuilt(highlightCode(source, "shell"))).toBe(source);
  });
});

describe("highlighting json", () => {
  it("gives back exactly what it was given", () => {
    const source = JSON.stringify({ name: "herald", version: "0.2.9", yanked: false, size: 12 }, null, 2);

    expect(rebuilt(highlightCode(source, "json"))).toBe(source);
  });

  it("tells a field's name from its value", () => {
    const tokens = highlightCode('{"package":"herald"}', "json");

    expect(coloured(tokens, "property")).toEqual(['"package"']);
    expect(coloured(tokens, "string")).toEqual(['"herald"']);
  });

  it("marks numbers and the three bare words", () => {
    const tokens = highlightCode('{"a":12,"b":true,"c":null}', "json");

    expect(coloured(tokens, "number")).toEqual(["12", "true", "null"]);
  });

  it("keeps a colon inside a string out of it", () => {
    const tokens = highlightCode('{"url":"https://example:8080/x"}', "json");

    expect(coloured(tokens, "property")).toEqual(['"url"']);
    expect(coloured(tokens, "string")).toEqual(['"https://example:8080/x"']);
  });
});

describe("highlighting anything else", () => {
  it("leaves text alone", () => {
    const tokens = highlightCode("just words", "text");

    expect(tokens).toEqual([{ text: "just words", kind: "plain" }]);
  });

  it("has nothing to say about nothing", () => {
    expect(highlightCode("", "text")).toEqual([]);
    expect(highlightCode("", "shell")).toEqual([]);
  });
});
