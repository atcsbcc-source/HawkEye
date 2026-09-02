"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { crumbsFor } from "@/lib/nav";
import { fmtLongDate } from "@/lib/format";
import { MobileNav } from "./MobileNav";
import { useHeaderTitle } from "./HeaderTitle";

/**
 * Console header: mobile nav trigger, breadcrumb (leaf in white), ops-timezone
 * date, and an `actions` slot at the far right (session chip lives there).
 */
export function Header({ actions }: { actions?: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { title } = useHeaderTitle();
  const crumbs = crumbsFor(pathname);
  const leafIdx = crumbs.length - 1;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-surface-border bg-surface-raised/80 px-4 backdrop-blur md:px-6">
      <MobileNav />

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
          {crumbs.map((c, i) => {
            const isLeaf = i === leafIdx;
            const label = isLeaf && title ? title : c.label;
            return (
              <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" aria-hidden />}
                {isLeaf ? (
                  <span
                    aria-current="page"
                    className="truncate normal-case tracking-normal text-sm font-semibold text-white"
                    title={label}
                  >
                    {label}
                  </span>
                ) : c.href ? (
                  <Link href={c.href} className="truncate transition hover:text-slate-200">
                    {c.label}
                  </Link>
                ) : (
                  <span className="truncate">{c.label}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <time
        dateTime={new Date().toISOString().slice(0, 10)}
        suppressHydrationWarning
        className="hidden shrink-0 text-xs text-slate-400 sm:block"
      >
        {fmtLongDate(Date.now())}
      </time>

      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
