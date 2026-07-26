import type { AdminPrincipal } from "../api/schemas";

export function profileSummaryItems(principal: AdminPrincipal): Array<[string, string]> {
  return [
    ["Username", principal.username],
    ["Role", principal.role],
    ["User ID", principal.subject],
  ];
}
