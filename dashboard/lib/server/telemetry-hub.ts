import { getAdapter, syncMissionProgress } from "./ops";

/**
 * Shared SSE telemetry hub: one 1 Hz ticker (unref'd, lazily started,
 * stopped when the last subscriber leaves) serialises the aircraft frame once
 * and fans it out, so cost is O(1) timers regardless of client count.
 */

export const MAX_SSE_CLIENTS = 25;
export const SSE_MAX_LIFETIME_MS = 15 * 60_000;
export const SSE_PING_EVERY_TICKS = 15;
const TICK_MS = 1000;

type Controller = ReadableStreamDefaultController<Uint8Array>;

interface Subscriber {
  controller: Controller;
  startedAt: number;
}

interface Hub {
  subscribers: Set<Subscriber>;
  timer: ReturnType<typeof setInterval> | null;
  ticks: number;
}

const g = globalThis as unknown as { __hawkeyeTelemetryHub?: Hub };
function hub(): Hub {
  if (!g.__hawkeyeTelemetryHub) {
    g.__hawkeyeTelemetryHub = { subscribers: new Set(), timer: null, ticks: 0 };
  }
  return g.__hawkeyeTelemetryHub;
}

const encoder = new TextEncoder();

function safeClose(sub: Subscriber): void {
  try {
    sub.controller.close();
  } catch {
    // already closed
  }
}

function tick(): void {
  const h = hub();
  if (h.subscribers.size === 0) {
    stop();
    return;
  }
  h.ticks += 1;
  let frame: Uint8Array;
  try {
    syncMissionProgress();
    frame = encoder.encode(`data: ${JSON.stringify(getAdapter().telemetry())}\n\n`);
  } catch (err) {
    console.error("[telemetry-hub] frame failed", (err as Error)?.message);
    return;
  }
  const ping = h.ticks % SSE_PING_EVERY_TICKS === 0 ? encoder.encode(": ping\n\n") : null;
  const now = Date.now();

  for (const sub of Array.from(h.subscribers)) {
    if (now - sub.startedAt > SSE_MAX_LIFETIME_MS) {
      h.subscribers.delete(sub);
      safeClose(sub); // EventSource reconnects on its own
      continue;
    }
    try {
      sub.controller.enqueue(frame);
      if (ping) sub.controller.enqueue(ping);
    } catch {
      h.subscribers.delete(sub);
    }
  }
  if (h.subscribers.size === 0) stop();
}

function start(): void {
  const h = hub();
  if (h.timer) return;
  h.timer = setInterval(tick, TICK_MS);
  h.timer.unref?.();
}

function stop(): void {
  const h = hub();
  if (h.timer) clearInterval(h.timer);
  h.timer = null;
  h.ticks = 0;
}

export function subscriberCount(): number {
  return hub().subscribers.size;
}

/** Build the first bytes for a new stream: retry hint + current frame. */
export function initialFrame(): Uint8Array {
  syncMissionProgress();
  return encoder.encode(`retry: 2000\n\ndata: ${JSON.stringify(getAdapter().telemetry())}\n\n`);
}

/**
 * Register a stream controller. Returns an idempotent unsubscribe. Throws
 * RangeError when MAX_SSE_CLIENTS is reached (route answers 503).
 */
export function subscribe(controller: Controller): () => void {
  const h = hub();
  if (h.subscribers.size >= MAX_SSE_CLIENTS) {
    throw new RangeError("telemetry hub full");
  }
  const sub: Subscriber = { controller, startedAt: Date.now() };
  h.subscribers.add(sub);
  start();
  return () => {
    if (h.subscribers.delete(sub) && h.subscribers.size === 0) stop();
  };
}
