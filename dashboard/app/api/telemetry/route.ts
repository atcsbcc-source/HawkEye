import { withAuth } from "@/lib/server/auth";
import { initialFrame, MAX_SSE_CLIENTS, subscribe, subscriberCount } from "@/lib/server/telemetry-hub";

export const dynamic = "force-dynamic";

/** GET /api/telemetry — 1 Hz server-sent-events stream of aircraft telemetry. */
export const GET = withAuth(async (req) => {
  if (subscriberCount() >= MAX_SSE_CLIENTS) {
    return new Response(JSON.stringify({ error: "Too many telemetry clients" }), {
      status: 503,
      headers: { "content-type": "application/json", "retry-after": "5" },
    });
  }

  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        unsubscribe = subscribe(controller);
      } catch {
        controller.close();
        return;
      }
      controller.enqueue(initialFrame());
      req.signal.addEventListener("abort", () => {
        unsubscribe?.();
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
