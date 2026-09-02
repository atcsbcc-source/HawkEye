import type { Metadata } from "next";
import Link from "next/link";
import { Crosshair, LayoutDashboard, Radar, Workflow } from "lucide-react";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "HawkEye Command Center",
  description: "Drone-driven vacancy reconnaissance for distressed-property leads",
};

const nav = [
  { href: "/", label: "Command Center", icon: LayoutDashboard },
  { href: "/operations", label: "Operations", icon: Radar },
  { href: "/automation", label: "Automation", icon: Workflow },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <aside className="hidden w-60 shrink-0 flex-col border-r border-surface-border bg-surface-raised md:flex">
            <div className="flex items-center gap-2 px-5 py-5">
              <Crosshair className="h-6 w-6 text-amber-400" />
              <div>
                <p className="text-sm font-bold tracking-widest text-white">HAWKEYE</p>
                <p className="text-[11px] text-slate-400">Vacancy Recon</p>
              </div>
            </div>
            <nav className="mt-2 flex flex-col gap-1 px-3">
              {nav.map(({ href, label, icon: Icon }) => (
                <Link
                  key={label}
                  href={href}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-surface hover:text-white"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto px-5 py-4 text-[11px] leading-relaxed text-slate-500">
              DJI Mavic 3 Classic
              <br />
              Weekly sortie · Oakwood grid
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <header className="flex items-center justify-between border-b border-surface-border bg-surface-raised/60 px-6 py-4 backdrop-blur">
              <h1 className="text-sm font-semibold text-white">HawkEye Console</h1>
              <span className="text-xs text-slate-400">
                {new Date().toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </header>
            <div className="p-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
