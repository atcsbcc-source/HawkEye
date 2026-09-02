"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Crosshair } from "lucide-react";
import { NAV, isNavActive } from "@/lib/nav";

export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isNavActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition",
              active
                ? "bg-sky-500/10 text-white before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r before:bg-sky-400"
                : "text-slate-400 hover:bg-surface hover:text-slate-100"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Brand() {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-surface-border px-4">
      <Crosshair className="h-6 w-6 text-amber-400" aria-hidden />
      <div className="leading-tight">
        <p className="text-sm font-bold tracking-widest text-white">HAWKEYE</p>
        <p className="text-label text-slate-400">Vacancy Recon</p>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-surface-border bg-surface-raised md:flex">
      <Brand />
      <div className="mt-3">
        <NavList />
      </div>
      <div className="mt-auto px-5 py-4 text-label normal-case leading-relaxed tracking-normal text-slate-400">
        DJI Mavic 3 Classic
        <br />
        Weekly sortie · Oakwood grid
      </div>
    </aside>
  );
}
