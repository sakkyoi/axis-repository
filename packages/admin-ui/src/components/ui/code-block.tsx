import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/utils";
import { highlightCode, type CodeLanguage, type CodeTokenKind } from "./code-highlight";
import { useClipboardCopyFeedback } from "./use-clipboard-copy-feedback";
import { useErrorToast } from "./toast";

/**
 * Restraint on purpose. What is not instruction -- comments, punctuation --
 * recedes; what is literal stands out; and the word that does something is in
 * the accent. More colours than that turn a command someone is about to run
 * into a decorated object.
 */
const tokenClasses: Record<CodeTokenKind, string> = {
  plain: "",
  comment: "text-muted-foreground",
  string: "text-success-ink",
  number: "text-warning-ink",
  keyword: "text-primary-ink",
  property: "text-primary-ink",
  punctuation: "text-muted-foreground",
};

export function CodeBlock({
  code,
  language = "text",
  className,
  copyable = true,
}: {
  code: string;
  language?: CodeLanguage;
  className?: string;
  copyable?: boolean;
}) {
  return (
    // The button is a sibling of the scrolling area rather than inside it, so
    // it stays in the corner while the code moves under it.
    <div className="relative min-w-0">
      <pre className={cn("overflow-auto rounded-md bg-muted p-3 text-xs", copyable && "pr-11", className)}>
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
      {copyable && <CopyCodeButton code={code} />}
    </div>
  );
}

/**
 * Copies the block, and says when it could not.
 *
 * The clipboard is a permission, and a refusal comes back as a rejected
 * promise -- which unhandled leaves the button looking as though it worked.
 */
function CopyCodeButton({ code }: { code: string }) {
  const { copied, copyText } = useClipboardCopyFeedback();
  const [failure, setFailure] = useState<unknown>();
  useErrorToast("Could not copy", failure);

  async function copy() {
    setFailure(undefined);
    try {
      await copyText(code);
    } catch (caught) {
      setFailure(caught);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? "Copied" : "Copy"}
      title={copied ? "Copied" : "Copy"}
      className={cn(
        "absolute right-1.5 top-1.5 rounded-md border border-border bg-panel p-1.5 transition-colors",
        copied ? "text-success-ink" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
