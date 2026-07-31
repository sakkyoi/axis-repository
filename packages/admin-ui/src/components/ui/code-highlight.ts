/**
 * Enough of a reader to colour the code this console shows.
 *
 * Two languages, and both of them ours: the shell lines are written by the
 * plugins that tell a client how to reach a repository, and the JSON is what
 * this server itself returns. Nothing arbitrary is highlighted here, which is
 * what makes a hundred lines the right size for this rather than a grammar
 * engine -- one of which would also have to be admitted through a policy that
 * refuses `eval` and the WebAssembly some of them compile with.
 *
 * Flags are deliberately not coloured. Marking them too puts a command and
 * its modifiers in the same colour, and a line reads as one green stripe
 * rather than as a verb with arguments after it.
 *
 * The output is tokens rather than markup. A highlighter that hands back HTML
 * has to be trusted with `dangerouslySetInnerHTML`, and colouring a command is
 * not worth that.
 *
 * A real one was measured rather than dismissed: Prism through `refractor`,
 * with only bash and json registered, costs about 14 KB gzipped, and
 * `prism-react-renderer` about 26 KB because it carries thirty-odd languages
 * nobody here asked for. Neither is a problem for a worker with 400 KB of room
 * left, so size is not the reason this is hand-written -- the closed set of
 * content is. Reach for refractor when that stops being true:
 *
 *   - plugins from outside this repository can emit shell of their own
 *   - a command turns up that this colours wrongly
 *   - a third language is wanted
 *
 * Prism's bash grammar knows heredoc bodies, `${...}` and `$(...)` expansion,
 * escapes and function definitions. This knows none of them, and does not need
 * to while every line it reads was written by the plugins in this repository.
 */

export type CodeLanguage = "shell" | "json" | "text";

export type CodeTokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "property"
  | "punctuation";

export interface CodeToken {
  text: string;
  kind: CodeTokenKind;
}

/** Where a word would be the command rather than one of its arguments. */
const COMMAND_POSITION = /(^|[\n|;&])\s*$/;

export function highlightCode(source: string, language: CodeLanguage): CodeToken[] {
  if (language === "shell") {
    return merge(tokenizeShell(source));
  }
  if (language === "json") {
    return merge(tokenizeJson(source));
  }
  return source ? [{ text: source, kind: "plain" }] : [];
}

/**
 * Runs of one kind become one token.
 *
 * The readers below emit a token per character where nothing matches, and a
 * span per character is a lot of spans for a paragraph of plain text.
 */
function merge(tokens: CodeToken[]): CodeToken[] {
  const merged: CodeToken[] = [];
  for (const token of tokens) {
    const last = merged[merged.length - 1];
    if (last && last.kind === token.kind) {
      last.text += token.text;
      continue;
    }
    merged.push({ ...token });
  }
  return merged;
}

function tokenizeShell(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < source.length) {
    const rest = source.slice(index);

    // A comment runs to the end of its line, and `#` mid-word is not one --
    // it appears inside URLs and inside quoted text.
    const comment = /^#[^\n]*/.exec(rest);
    if (comment && (index === 0 || /[\s]/.test(source[index - 1] ?? ""))) {
      tokens.push({ text: comment[0], kind: "comment" });
      index += comment[0].length;
      continue;
    }

    // Single quotes take everything to the next quote, backslash included:
    // that is what makes them the safe way to write a heredoc delimiter.
    const single = /^'[^']*'?/.exec(rest);
    if (single) {
      tokens.push({ text: single[0], kind: "string" });
      index += single[0].length;
      continue;
    }

    const double = /^"(?:[^"\\]|\\.)*"?/.exec(rest);
    if (double) {
      tokens.push({ text: double[0], kind: "string" });
      index += double[0].length;
      continue;
    }

    const punctuation = /^(?:\|\||&&|<<-?|>>|[|<>;&])/.exec(rest);
    if (punctuation) {
      tokens.push({ text: punctuation[0], kind: "punctuation" });
      index += punctuation[0].length;
      continue;
    }

    const word = /^[A-Za-z_][\w.-]*/.exec(rest);
    if (word) {
      const isCommand = COMMAND_POSITION.test(source.slice(0, index));
      tokens.push({ text: word[0], kind: isCommand ? "keyword" : "plain" });
      index += word[0].length;
      continue;
    }

    tokens.push({ text: source[index] as string, kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeJson(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < source.length) {
    const rest = source.slice(index);

    const text = /^"(?:[^"\\]|\\.)*"?/.exec(rest);
    if (text) {
      // A string before a colon names a field rather than being a value, and
      // reading an object is mostly looking for the names.
      const isProperty = /^\s*:/.test(rest.slice(text[0].length));
      tokens.push({ text: text[0], kind: isProperty ? "property" : "string" });
      index += text[0].length;
      continue;
    }

    const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      tokens.push({ text: number[0], kind: "number" });
      index += number[0].length;
      continue;
    }

    const literal = /^(?:true|false|null)\b/.exec(rest);
    if (literal) {
      tokens.push({ text: literal[0], kind: "number" });
      index += literal[0].length;
      continue;
    }

    const punctuation = /^[{}[\],:]/.exec(rest);
    if (punctuation) {
      tokens.push({ text: punctuation[0], kind: "punctuation" });
      index += punctuation[0].length;
      continue;
    }

    tokens.push({ text: source[index] as string, kind: "plain" });
    index += 1;
  }

  return tokens;
}
