import { KeyRound, UserCircle } from "lucide-react";
import { useAdminSession } from "../api/hooks";
import { Badge } from "../components/ui/badge";
import { ChangePasswordDialog } from "../users/change-password-dialog";
import { profileSummaryItems } from "../profile/profile-page-model";
import { ErrorState, PageShell } from "./shared";

export function ProfilePage() {
  const session = useAdminSession();
  const principal = session.data?.principal;

  return (
    <PageShell
      title="Profile"
      description="Your admin identity and account security settings."
    >
      {session.isLoading && <div className="text-sm text-muted-foreground">Loading profile...</div>}
      {session.error && <ErrorState title="Profile unavailable" error={session.error} />}
      {principal && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="grid content-start gap-4 rounded-lg border border-border bg-panel p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <UserCircle className="h-5 w-5 text-muted-foreground" />
                  <h2 className="truncate text-base font-semibold">{principal.username}</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Account identity is managed by this Axis Repository deployment.
                </p>
              </div>
              <Badge variant="success">{principal.role}</Badge>
            </div>

            <div className="grid gap-3 rounded-md border border-border bg-background/40 p-4">
              {profileSummaryItems(principal).map(([label, value]) => (
                <div key={label} className="grid gap-1">
                  <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
                  <span className="break-all text-sm">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <aside className="grid content-start gap-4 rounded-lg border border-border bg-panel p-5">
            <div>
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Security</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Rotate your password when access may have been shared or exposed.
              </p>
            </div>
            <ChangePasswordDialog />
          </aside>
        </div>
      )}
    </PageShell>
  );
}
