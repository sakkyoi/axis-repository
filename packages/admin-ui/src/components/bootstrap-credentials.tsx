import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useDeployment } from "../api/hooks";
import { ADMIN_UI_PATHS } from "../navigation";
import { CodeBlock } from "./ui/code-block";
import { useToast } from "./ui/toast";
import { leftoverBannerText, leftoverNeedsBanner } from "./bootstrap-credentials-model";

/**
 * Names the card rather than the page, so that a link to it lands on the thing
 * it was talking about instead of the top of Settings.
 */
export const BOOTSTRAP_CREDENTIALS_ANCHOR = "bootstrap-credentials";

/**
 * Says, once a session, that this deployment is still holding what seeded it.
 *
 * Raised rather than drawn into the page, because the reader did not come here
 * to find this out and there is no page they would have gone to. As a warning
 * it waits to be dismissed instead of expiring while it is being read.
 *
 * Being dismissible is the cost of saying it this way: closed, it is gone
 * until the console is opened again, whereas the state it describes is not.
 * So it carries the way to the card that keeps the full account, and closing
 * it after following that is the reader having dealt with it.
 */
export function useBootstrapCredentialsToast(): void {
  const toast = useToast();
  const deployment = useDeployment();
  const leftover = deployment.data?.leftoverBootstrapCredentials ?? [];
  const message = leftoverNeedsBanner(leftover) ? leftoverBannerText(leftover) : undefined;
  const announced = useRef<string | undefined>(undefined);

  // Announced once per distinct finding: the query is read by more than one
  // component and refetches on its own, and a warning that reappears every
  // time is one that gets closed without being read.
  useEffect(() => {
    if (message === undefined || announced.current === message) {
      return;
    }
    announced.current = message;
    toast.notify({
      title: message,
      description: "The admin account it created already exists, so it is never read again.",
      tone: "warning",
      // To the card rather than to Settings: the page has several of them, and
      // the one this is about is not the first.
      action: {
        label: "How to remove it",
        to: { pathname: ADMIN_UI_PATHS.settings, hash: `#${BOOTSTRAP_CREDENTIALS_ANCHOR}` },
      },
    });
  }, [message, toast]);
}

/**
 * The same facts at length, for someone who has come looking.
 *
 * Each row says where the value is declared rather than only that it should
 * go, because the two are removed in different places and a deployment that
 * declares one as a variable will hand it back on the next deploy.
 */
export function BootstrapCredentialsCard() {
  const deployment = useDeployment();
  const location = useLocation();
  const heading = useRef<HTMLElement>(null);
  const leftover = deployment.data?.leftoverBootstrapCredentials ?? [];
  const arrived = location.hash === `#${BOOTSTRAP_CREDENTIALS_ANCHOR}`;
  const shown = leftover.length;

  // Runs once the rows exist rather than once the page does: followed from the
  // banner, the card is still waiting on its own request when Settings mounts,
  // and scrolling to something that is not there yet scrolls nowhere.
  useEffect(() => {
    if (arrived && shown > 0) {
      heading.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [arrived, shown]);

  if (deployment.isLoading || shown === 0) {
    return null;
  }

  return (
    <section
      id={BOOTSTRAP_CREDENTIALS_ANCHOR}
      ref={heading}
      className="grid scroll-mt-4 gap-3 rounded-lg border border-border bg-panel p-5"
    >
      <div>
        <h2 className="text-base font-semibold">Bootstrap credentials</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Values that seeded the first admin account. That account exists, so none of them is read
          any more — removing them is safe, and does not change the account.
        </p>
      </div>
      <ul className="grid gap-3">
        {leftover.map((credential) => (
          <li key={credential.name} className="grid gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-sm">{credential.name}</code>
              {credential.sensitive
                ? (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-ink">
                    Still readable from this deployment
                  </span>
                )
                : <span className="text-xs text-muted-foreground">No longer read</span>}
            </div>
            <p className="text-sm text-muted-foreground">{credential.removal}</p>
            <CodeBlock code={credential.command} language="shell" />
          </li>
        ))}
      </ul>
    </section>
  );
}
