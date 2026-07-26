import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, LogOut, UserCircle } from "lucide-react";
import { createAxisClient } from "../api/client";
import { useAdminSession } from "../api/hooks";
import { useAuth } from "../auth";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { ADMIN_UI_PATHS } from "../navigation";
import { getRuntimeConfig } from "../runtime-config";

export function ProfileMenu() {
  const auth = useAuth();
  const session = useAdminSession();
  const [open, setOpen] = useState(false);
  const username = session.data?.principal.username ?? "Profile";

  async function logout() {
    setOpen(false);
    try {
      await createAxisClient({
        accessToken: auth.accessToken,
        baseUrl: getRuntimeConfig().apiBaseUrl,
      }).logoutAdmin();
    } finally {
      auth.logout();
    }
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        className="gap-2"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <UserCircle className="h-4 w-4" />
        <span className="max-w-32 truncate">{username}</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 grid w-56 gap-1 rounded-lg border border-border bg-panel p-1 shadow-xl"
        >
          <Link
            role="menuitem"
            to={ADMIN_UI_PATHS.profile}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <UserCircle className="h-4 w-4 text-muted-foreground" />
            Profile settings
          </Link>
          <button
            role="menuitem"
            type="button"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            onClick={() => void logout()}
          >
            <LogOut className="h-4 w-4 text-muted-foreground" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
