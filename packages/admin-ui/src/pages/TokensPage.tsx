import { useState } from "react";
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { DestructiveActionDialog } from "../components/ui/destructive-action-dialog";
import {
  useDeletePublishToken,
  usePublishTokens,
  useRepositories,
  useRevokePublishToken,
  useRotatePublishToken,
} from "../api/hooks";
import type { PublishToken, PublishTokenCreateResponse } from "../api/schemas";
import {
  deletePublishTokenDialogContent,
  publishTokenDetailActionRowClass,
  publishTokenDetailBodyClass,
  publishTokenListEmptyClass,
  publishTokenListEmptyPanelClass,
  publishTokenLifecycle,
  publishTokenRawMetadataClass,
  publishTokenRawMetadataContainerClass,
  publishTokenRowStateClass,
  publishTokenSummaryGridClass,
  publishTokenSummaryItemClass,
  publishTokenSummaryItems,
  publishTokenSummaryValueClass,
  rotatePublishTokenDialogContent,
  revokePublishTokenDialogContent,
} from "../tokens/publish-token-form-model";
import { CreateTokenDialog, TokenCreatedDialog } from "../tokens/publish-token-dialogs";
import { asJson, ErrorState, PageShell, formatDate } from "./shared";

export function TokensPage() {
  const tokens = usePublishTokens();
  const repositories = useRepositories();
  const [selectedName, setSelectedName] = useState<string>();
  const [pendingRevokeName, setPendingRevokeName] = useState<string>();
  const [pendingRotateName, setPendingRotateName] = useState<string>();
  const [pendingDeleteName, setPendingDeleteName] = useState<string>();
  const [revealedToken, setRevealedToken] = useState<PublishTokenCreateResponse>();
  const selected = tokens.data?.find((token) => token.name === selectedName);
  const revoke = useRevokePublishToken();
  const rotate = useRotatePublishToken();
  const deleteToken = useDeletePublishToken();
  const revokeDialogContent = pendingRevokeName ? revokePublishTokenDialogContent(pendingRevokeName) : undefined;
  const rotateDialogContent = pendingRotateName ? rotatePublishTokenDialogContent(pendingRotateName) : undefined;
  const pendingDeleteToken = tokens.data?.find((token) => token.name === pendingDeleteName);
  const pendingDeleteLifecycle = pendingDeleteToken ? publishTokenLifecycle(pendingDeleteToken) : undefined;
  const deleteDialogContent = pendingDeleteName
    ? deletePublishTokenDialogContent(pendingDeleteName, Boolean(pendingDeleteLifecycle?.active))
    : undefined;

  function closeRevokeDialog() {
    if (revoke.isPending) return;
    setPendingRevokeName(undefined);
    revoke.reset();
  }

  function confirmRevokeToken() {
    if (!pendingRevokeName) return;
    revoke.mutate(pendingRevokeName, {
      onSuccess: () => setPendingRevokeName(undefined),
    });
  }

  function closeRotateDialog() {
    if (rotate.isPending) return;
    setPendingRotateName(undefined);
    rotate.reset();
  }

  function confirmRotateToken() {
    if (!pendingRotateName) return;
    rotate.mutate(pendingRotateName, {
      onSuccess: (result) => {
        setPendingRotateName(undefined);
        setRevealedToken(result);
      },
    });
  }

  function closeDeleteDialog() {
    if (deleteToken.isPending) return;
    setPendingDeleteName(undefined);
    deleteToken.reset();
  }

  function confirmDeleteToken() {
    if (!pendingDeleteName) return;
    const deletingName = pendingDeleteName;
    deleteToken.mutate(deletingName, {
      onSuccess: () => {
        setPendingDeleteName(undefined);
        if (selectedName === deletingName) {
          setSelectedName(undefined);
        }
      },
    });
  }

  return (
    <PageShell
      title="Publish Tokens"
      description="Create scoped automation tokens and revoke them when they are no longer needed."
      bodyClassName="min-h-0 content-stretch overflow-hidden"
      action={<CreateTokenDialog repositories={repositories.data ?? []} repositoriesLoading={repositories.isLoading} />}
    >
      {repositories.isError && <ErrorState title="Repositories unavailable" error={repositories.error} />}
      {tokens.isError && <ErrorState error={tokens.error} />}
      {tokens.isLoading && <div className="text-sm text-muted-foreground">Loading publish tokens...</div>}
      {tokens.data && (
        <div className="grid h-full min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <div className="min-h-0 min-w-0 overflow-auto rounded-lg border border-border bg-panel">
            {tokens.data.length === 0 ? (
              <div className={publishTokenListEmptyClass()}>
                <div className={publishTokenListEmptyPanelClass()}>
                  No publish tokens have been created.
                </div>
              </div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Permissions</th>
                    <th className="px-3 py-2">Repositories</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.data.map((token) => (
                    <PublishTokenRow
                      key={token.id}
                      token={token}
                      selectedName={selectedName}
                      onSelect={() => setSelectedName(token.name)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {selected ? (
            <PublishTokenDetail
              token={selected}
              actionPending={revoke.isPending || rotate.isPending || deleteToken.isPending}
              onRevoke={() => setPendingRevokeName(selected.name)}
              onRotate={() => setPendingRotateName(selected.name)}
              onDelete={() => setPendingDeleteName(selected.name)}
            />
          ) : <PublishTokenDetailEmptyState />}
        </div>
      )}
      {revokeDialogContent && (
        <DestructiveActionDialog
          open={Boolean(pendingRevokeName)}
          title={revokeDialogContent.title}
          description={revokeDialogContent.description}
          confirmLabel={revokeDialogContent.confirmLabel}
          pendingLabel={revokeDialogContent.pendingLabel}
          confirmationText={revokeDialogContent.confirmationText}
          pending={revoke.isPending}
          error={revoke.isError ? revoke.error : undefined}
          onOpenChange={(open) => {
            if (!open) {
              closeRevokeDialog();
            }
          }}
          onConfirm={confirmRevokeToken}
        />
      )}
      {rotateDialogContent && (
        <DestructiveActionDialog
          open={Boolean(pendingRotateName)}
          title={rotateDialogContent.title}
          description={rotateDialogContent.description}
          confirmLabel={rotateDialogContent.confirmLabel}
          pendingLabel={rotateDialogContent.pendingLabel}
          confirmationText={rotateDialogContent.confirmationText}
          pending={rotate.isPending}
          error={rotate.isError ? rotate.error : undefined}
          onOpenChange={(open) => {
            if (!open) {
              closeRotateDialog();
            }
          }}
          onConfirm={confirmRotateToken}
        />
      )}
      {deleteDialogContent && (
        <DestructiveActionDialog
          open={Boolean(pendingDeleteName)}
          title={deleteDialogContent.title}
          description={deleteDialogContent.description}
          confirmLabel={deleteDialogContent.confirmLabel}
          pendingLabel={deleteDialogContent.pendingLabel}
          confirmationText={deleteDialogContent.confirmationText}
          pending={deleteToken.isPending}
          error={deleteToken.isError ? deleteToken.error : undefined}
          onOpenChange={(open) => {
            if (!open) {
              closeDeleteDialog();
            }
          }}
          onConfirm={confirmDeleteToken}
        />
      )}
      <TokenCreatedDialog
        result={revealedToken}
        onClose={() => setRevealedToken(undefined)}
      />
    </PageShell>
  );
}

function PublishTokenRow({
  token,
  selectedName,
  onSelect,
}: {
  token: PublishToken;
  selectedName: string | undefined;
  onSelect: () => void;
}) {
  const lifecycle = publishTokenLifecycle(token);
  return (
    <tr
      className={`cursor-pointer border-t border-border ${publishTokenRowStateClass(token.name, selectedName)}`}
      onClick={onSelect}
    >
      <td className="px-3 py-2 font-medium">{token.name}</td>
      <td className="px-3 py-2">{token.permissions.join(", ")}</td>
      <td className="px-3 py-2">{token.repositories.join(", ")}</td>
      <td className="px-3 py-2">
        <Badge variant={lifecycle.variant}>
          {lifecycle.label}
        </Badge>
      </td>
    </tr>
  );
}

function PublishTokenDetailEmptyState() {
  return (
    <aside className="grid min-h-0 min-w-0 place-items-center rounded-lg border border-dashed border-border bg-panel p-6">
      <div className="max-w-xs text-center">
        <h2 className="text-sm font-semibold">Select a token</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose an item from the token list to inspect its scopes.
        </p>
      </div>
    </aside>
  );
}

function PublishTokenDetail({
  token,
  actionPending,
  onRevoke,
  onRotate,
  onDelete,
}: {
  token: PublishToken;
  actionPending: boolean;
  onRevoke: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const summaryItems = publishTokenSummaryItems(token);
  const lifecycle = publishTokenLifecycle(token);
  return (
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-panel">
      <div className="sticky top-0 z-10 border-b border-border bg-panel p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{token.name}</h2>
            <p className="text-sm text-muted-foreground">Created {formatDate(token.createdAt)}</p>
          </div>
          <Badge className="shrink-0" variant={lifecycle.variant}>
            {lifecycle.label}
          </Badge>
        </div>
      </div>
      <div className={publishTokenDetailBodyClass()}>
        <div className={publishTokenDetailActionRowClass()}>
          <Button
            variant="destructive"
            size="sm"
            className="w-full min-w-0 px-2"
            disabled={!lifecycle.active || actionPending}
            onClick={onRevoke}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Revoke token
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full min-w-0 px-2"
            disabled={!lifecycle.active || actionPending}
            onClick={onRotate}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Rotate token
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="w-full min-w-0 px-2"
            disabled={actionPending}
            onClick={onDelete}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete token
          </Button>
        </div>
        <div className={publishTokenSummaryGridClass()}>
          {summaryItems.map(([label, value]) => (
            <div key={label} className={publishTokenSummaryItemClass()}>
              <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
              <span className={publishTokenSummaryValueClass()}>
                {label === "Created" || (label === "Last rotated" || label === "Expires") && value !== "never"
                  ? formatDate(value)
                  : value}
              </span>
            </div>
          ))}
        </div>
        <details className={publishTokenRawMetadataContainerClass()}>
          <summary className="cursor-pointer text-sm font-medium">Raw token metadata</summary>
          <pre className={publishTokenRawMetadataClass()}>{asJson(token)}</pre>
        </details>
      </div>
    </aside>
  );
}
