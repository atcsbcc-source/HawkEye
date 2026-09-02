"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

/** Icon button with a KMZ (DJI WPML) / KML (Google Earth) download menu. */
export function MissionExportButton({ missionId }: { missionId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Export flight plan"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-sky-500/50 p-1 text-sky-300 transition hover:bg-sky-500/10"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-surface-border bg-surface-raised shadow-xl"
        >
          <a
            role="menuitem"
            href={`/api/missions/${missionId}/kmz`}
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-xs text-slate-200 transition hover:bg-surface"
          >
            <span className="font-medium">KMZ</span>
            <span className="block text-[11px] text-slate-400">DJI WPML · DJI Fly / Pilot 2</span>
          </a>
          <a
            role="menuitem"
            href={`/api/missions/${missionId}/kml`}
            onClick={() => setOpen(false)}
            className="block border-t border-surface-border px-3 py-2 text-xs text-slate-200 transition hover:bg-surface"
          >
            <span className="font-medium">KML</span>
            <span className="block text-[11px] text-slate-400">Polygon + path · Google Earth</span>
          </a>
        </div>
      )}
    </div>
  );
}
