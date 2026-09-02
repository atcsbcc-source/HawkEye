"use client";

import { useState, type FormEvent } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

export function SetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) return setError("Use at least 12 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    const db = getBrowserSupabase();
    if (!db) return setError("Auth is not configured.");
    setBusy(true);
    const { error: err } = await db.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError("Could not set password. The link may have expired.");
    window.location.assign("/");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        New password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-surface-border bg-surface px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Confirm password
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="rounded-md border border-surface-border bg-surface px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="mt-2 rounded-md bg-amber-400 px-3 py-2 text-sm font-semibold text-surface transition hover:bg-amber-300 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
