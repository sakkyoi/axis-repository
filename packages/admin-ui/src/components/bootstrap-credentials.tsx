import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useDeployment } from "../api/hooks";
import { ADMIN_UI_PATHS } from "../navigation";
import { Alert } from "./ui/alert";
import { CodeBlock } from "./ui/code-block";
import { leftoverBannerText, leftoverNeedsBanner } from "./bootstrap-credentials-model";

/**
 * Names the card rather than the page, so that arriving from the banner lands
 * on the thing it was talking about instead of the top of Settings.
 */
export const BOOTSTRAP_CREDENTIALS_ANCHOR = "bootstrap-credentials";

/**
 * Says that this deployment is still holding the password that seeded it.
 *
 * Above the page rather than inside it, because the reader did not come here
 * to find this out and there is no page they would have gone to. It does not
 * close: it describes a state of the deployment rather than an event, and the
 * only thing that ends it is removing the value, at which point it goes on its
 * own.
 */
export function BootstrapCredentialsBanner() {
  const deployment = useDeployment();
  const leftover = deployment.data?.leftoverBootstrapCredentials ?? [];

  if (!leftoverNeedsBanner(leftover)) {
    return null;
  }

  return (
    <Alert
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-none border-x-0 border-t-0 border-b-warning/40 bg-warning/10"
    >
      <ShieldAlert className="h-4 w-4 shrink-0 text-warning-ink" aria-hidden="true" />
      <span className="min-w-0">
        <span className="font-medium">{leftoverBannerText(leftover)}</span>{" "}
        <span className="text-muted-foreground">
          The admin account it created already exists, so it is never read again.
        </span>
      </span>
      <Link
        to={{ pathname: ADMIN_UI_PATHS.settings, hash: `#${BOOTSTRAP_CREDENTIALS_ANCHOR}` }}
        className="ml-auto shrink-0 font-medium text-primary-ink underline-offset-4 hover:underline"
      >
        How to remove it
      </Link>
    </Alert>
  );
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
