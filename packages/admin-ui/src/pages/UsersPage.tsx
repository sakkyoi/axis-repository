import { UserPlus, Users } from "lucide-react";
import { useAdminUsers } from "../api/hooks";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ErrorState, PageShell, formatDate } from "./shared";
import { SkeletonRows } from "../components/ui/skeleton";

export function UsersPage() {
  const adminUsers = useAdminUsers();
  const users = adminUsers.data?.users ?? [];

  return (
    <PageShell
      title="Users"
      description="Admin identities for this Axis Repository deployment."
      action={(
        <Button type="button" variant="outline" disabled>
          <UserPlus className="mr-2 h-4 w-4" />
          Add user
        </Button>
      )}
    >
      <section className="grid content-start gap-2 rounded-lg border border-border bg-panel p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Admin users</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The first owner is seeded from bootstrap environment settings. Additional users are coming soon.
            </p>
          </div>
          <Badge variant="warning">Coming soon</Badge>
        </div>

        {adminUsers.isLoading && (
          <div className="rounded-md border border-border">
            <SkeletonRows rows={3} columns={["w-36", "w-20", "w-28"]} />
          </div>
        )}
        {adminUsers.error && <ErrorState title="Admin users unavailable" error={adminUsers.error} />}
        {!adminUsers.isLoading && !adminUsers.error && users.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            No admin users have been seeded yet.
          </div>
        )}
        {users.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[minmax(180px,1fr)_120px_minmax(180px,1fr)_160px] border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <span>User</span>
                <span>Role</span>
                <span>Status</span>
                <span>Created</span>
              </div>
              <div className="divide-y divide-border">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="grid grid-cols-[minmax(180px,1fr)_120px_minmax(180px,1fr)_160px] gap-3 px-3 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{user.displayName}</span>
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{user.username}</div>
                    </div>
                    <div>
                      <Badge>{user.role}</Badge>
                    </div>
                    <div>
                      {user.disabledAt ? (
                        <Badge variant="destructive">Disabled</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{formatDate(user.createdAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </PageShell>
  );
}
