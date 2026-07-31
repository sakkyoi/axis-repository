import { cn } from "../../lib/utils";
import { highlightCode, type CodeLanguage, type CodeTokenKind } from "./code-highlight";

/**
 * Restraint on purpose. What is not instruction -- comments, punctuation --
 * recedes; what is literal stands out; and the word that does something is in
 * the accent. More colours than that turn a command someone is about to run
 * into a decorated object.
 */
const tokenClasses: Record<CodeTokenKind, string> = {
  plain: "",
  comment: "text-muted-foreground",
  string: "text-success",
  number: "text-warning",
  keyword: "text-primary",
  property: "text-primary",
  punctuation: "text-muted-foreground",
};

export function CodeBlock({
  code,
  language = "text",
  className,
}: {
  code: string;
  language?: CodeLanguage;
  className?: string;
}) {
  return (
    <pre className={cn("overflow-auto rounded-md bg-muted p-3 text-xs", className)}>
      <code>
        {highlightCode(code, language).map((token, index) => (
          token.kind === "plain"
            ? token.text
            // The index is the key because a token has no identity of its own:
            // the same word appears many times and means the same each time.
            : <span key={index} className={tokenClasses[token.kind]}>{token.text}</span>
        ))}
      </code>
    </pre>
  );
}
