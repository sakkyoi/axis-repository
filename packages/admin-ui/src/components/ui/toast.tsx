import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toastAutoDismissMs } from "./toast-model";

export interface ToastMessage {
  title: string;
  description?: string;
}

interface ToastRecord extends ToastMessage {
  id: number;
}

interface ToastContextValue {
  notify(message: ToastMessage): void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const value = useMemo<ToastContextValue>(() => ({
    notify(message) {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { ...message, id }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, toastAutoDismissMs());
    },
  }), []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 grid w-[min(92vw,360px)] gap-2" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="rounded-md border border-border bg-panel p-3 text-sm shadow-lg">
            <div className="font-medium">{toast.title}</div>
            {toast.description && <div className="mt-1 text-xs text-muted-foreground">{toast.description}</div>}
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
