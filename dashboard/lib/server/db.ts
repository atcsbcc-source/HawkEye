import type { PostgrestError } from "@supabase/supabase-js";

/**
 * A Supabase write/read that returned an error. `ctx` is a short, operator-safe
 * description of what was attempted ("insert audit_events"); `cause` carries
 * the PostgREST error for the server log. Route wrappers map this to a 500.
 */
export class DbError extends Error {
  constructor(
    public readonly ctx: string,
    public readonly cause: PostgrestError,
  ) {
    super(`${ctx}: ${cause.message}`);
    this.name = "DbError";
  }
}

type DbResult<T> = { data: T | null; error: PostgrestError | null };

/**
 * Await a PostgREST builder and throw `DbError` instead of silently returning
 * `{ error }`. Every write in lib/server goes through here so a rejected
 * statement can never look like success.
 */
export async function must<T>(q: PromiseLike<DbResult<T>>, ctx: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw new DbError(ctx, error);
  return data as T;
}
