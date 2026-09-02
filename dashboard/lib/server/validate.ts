import { NextResponse } from "next/server";
import type { z } from "zod";

/** JSON error response helper. */
export function apiError(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; res: NextResponse };

/**
 * Read and validate a JSON body:
 *  - content-type must start with application/json
 *  - content-length (when present) and the streamed body are capped at maxBytes (413)
 *  - schema failure -> 400 { error, issues }
 */
export async function parseJson<S extends z.ZodType>(
  req: Request,
  schema: S,
  opts: { maxBytes?: number } = {}
): Promise<ParseResult<z.output<S>>> {
  const maxBytes = opts.maxBytes ?? 16_384;

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) {
    return { ok: false, res: apiError("Content-Type must be application/json", 415) };
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, res: apiError(`Body exceeds ${maxBytes} bytes`, 413) };
  }

  let text: string;
  try {
    text = await readCapped(req, maxBytes);
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      return { ok: false, res: apiError(`Body exceeds ${maxBytes} bytes`, 413) };
    }
    return { ok: false, res: apiError("Unable to read request body", 400) };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, res: apiError("Invalid JSON body", 400) };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => ({
      path: i.path.map(String).join("."),
      message: i.message,
    }));
    return {
      ok: false,
      res: NextResponse.json({ error: "Invalid request body", issues }, { status: 400 }),
    };
  }
  return { ok: true, data: parsed.data };
}

class BodyTooLarge extends Error {}

async function readCapped(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Validate URL search params against a schema (400 on failure). */
export function parseQuery<S extends z.ZodType>(
  req: Request,
  schema: S
): ParseResult<z.output<S>> {
  const sp = new URL(req.url).searchParams;
  const obj: Record<string, string> = {};
  sp.forEach((v, k) => {
    obj[k] = v;
  });
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => ({
      path: i.path.map(String).join("."),
      message: i.message,
    }));
    return {
      ok: false,
      res: NextResponse.json({ error: "Invalid query", issues }, { status: 400 }),
    };
  }
  return { ok: true, data: parsed.data };
}
