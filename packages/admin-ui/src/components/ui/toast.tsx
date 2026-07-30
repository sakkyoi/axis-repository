import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toastDismissAfterMs, toastErrorMessage, type ToastTone } from "./toast-model";

export interface ToastMessage {
  title: string;
  description?: string;
  /** Defaults to a confirmation, which takes itself away. */
  tone?: ToastTone;
}

interface ToastRecord extends ToastMessage {
  id: number;
  tone: ToastTone;
}

interface ToastContextValue {
  notify(message: ToastMessage): void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    notify(message) {
      const id = Date.now() + Math.random();
      const tone = message.tone ?? "info";
      setToasts((current) => [...current, { ...message, tone, id }]);
      const dismissAfter = toastDismissAfterMs(tone);
      if (dismissAfter !== undefined) {
        window.setTimeout(() => dismiss(id), dismissAfter);
      }
    },
  }), [dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Above a dialog rather than behind it: a failure raised by something
          done in a dialog has to be readable without closing the dialog. */}
      <div className="fixed bottom-4 right-4 z-[60] grid w-[min(92vw,360px)] gap-2" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={toast.tone === "error"
              ? "rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive shadow-lg"
              : "rounded-md border border-border bg-panel p-3 text-sm shadow-lg"}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{toast.title}</div>
                {toast.description && (
                  <div className={toast.tone === "error" ? "mt-1 break-words text-xs" : "mt-1 break-words text-xs text-muted-foreground"}>
                    {toast.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={`Dismiss ${toast.title}`}
                className="-mr-1 -mt-1 shrink-0 rounded px-1 text-xs opacity-70 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return value;
}

/**
 * Raises a failure as a message, once, for as long as it is the same failure.
 *
 * Queries re-render for reasons of their own, and a component can render many
 * times holding one error; saying it each time would bury the corner in copies
 * of a single problem. It is raised when the failure appears, and again only
 * when it becomes a different one.
 *
 * Silent with no provider above it, so a component can be rendered on its own
 * -- in a test, say -- without arranging for one.
 */
export function useErrorToast(title: string, error: unknown): void {
  const toast = useContext(ToastContext);
  const message = error === undefined || error === null || error === false || error === ""
    ? undefined
    : toastErrorMessage(error);
  const announced = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (message === undefined) {
      announced.current = undefined;
      return;
    }
    const announcement = `${title}\n${message}`;
    if (announced.current === announcement) {
      return;
    }
    announced.current = announcement;
    toast?.notify({ title, description: message, tone: "error" });
  }, [title, message, toast]);
}
