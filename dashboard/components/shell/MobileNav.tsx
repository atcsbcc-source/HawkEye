"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Brand, NavList } from "./Sidebar";

const DRAWER_ID = "mobile-nav-drawer";

/** Hamburger + off-canvas drawer, rendered only below `md`. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes; focus moves into the drawer and back to the trigger.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-controls={DRAWER_ID}
        aria-expanded={open}
        aria-label="Open navigation"
        className="btn-ghost -ml-2 h-9 w-9 px-0"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            id={DRAWER_ID}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-surface-border bg-surface-raised shadow-2xl"
          >
            <div className="relative">
              <Brand />
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="btn-ghost absolute right-2 top-2.5 h-9 w-9 px-0"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="mt-3">
              <NavList onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
