"use client";

import { useState, type FormEvent } from "react";

/** Only allow same-origin relative paths as the post-login destination. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.startsWith("/login") || raw.startsWith("/auth/") || raw.startsWith("/api/")) return "/";
  return raw;
}

export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        window.location.assign(safeNext(next));
        return;
      }
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute and try again.");
      } else if (res.status === 503) {
        setError("Sign-in is not configured on this deployment.");
      } else {
        setError("Invalid credentials");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Email
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-surface-border bg-surface px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        disabled={busy || !email || !password}
        className="mt-2 rounded-md bg-amber-400 px-3 py-2 text-sm font-semibold text-surface transition hover:bg-amber-300 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-[11px] text-slate-500">
        Access is invite-only. Ask an administrator for an invitation.
      </p>
    </form>
  );
}
