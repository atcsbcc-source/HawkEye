"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (kind: ToastKind, message: string, ttlMs?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE: Record<ToastKind, string> = {
  success: "border-emerald-500/40 text-emerald-200",
  error: "border-red-500/40 text-red-200",
  info: "border-sky-500/40 text-sky-200",
};

const ICON: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />,
  error: <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />,
  info: <Info className="h-4 w-4 shrink-0 text-sky-400" />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, ttlMs = kind === "error" ? 8000 : 5000) => {
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-4), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), ttlMs);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto flex items-start gap-2 rounded-lg border bg-surface-raised px-3 py-2 text-sm shadow-lg shadow-black/40",
              TONE[t.kind],
            )}
          >
            {ICON[t.kind]}
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="-mr-1 rounded p-0.5 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const NOOP: ToastApi = {
  push: () => undefined,
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
  dismiss: () => undefined,
};

/** Toast API; safe to call outside a provider (no-op). */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}
