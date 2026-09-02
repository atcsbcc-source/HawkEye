"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, FileUp, Plus } from "lucide-react";
import { ImportDialog } from "./ImportDialog";

const btn =
  "flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-xs text-slate-300 transition hover:border-sky-500/50 hover:text-white";

/** Toolbar above the lead grid: add / import / export. */
export function LeadActions() {
  const [importing, setImporting] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <a href="/api/leads/export?format=csv" className={btn} download>
        <Download className="h-3.5 w-3.5" /> Export CSV
      </a>
      <button onClick={() => setImporting(true)} className={btn}>
        <FileUp className="h-3.5 w-3.5" /> Import parcels
      </button>
      <Link
        href="/properties/new"
        className="flex items-center gap-2 rounded-lg border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-xs text-sky-300 transition hover:bg-sky-500/20"
      >
        <Plus className="h-3.5 w-3.5" /> Add property
      </Link>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
