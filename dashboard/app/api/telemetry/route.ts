import { getAdapter, syncMissionProgress } from "@/lib/server/ops";

export const dynamic = "force-dynamic";

/** GET /api/telemetry — 1 Hz server-sent-events stream of aircraft telemetry. */
export async function GET() {
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        syncMissionProgress();
        const frame = `data: ${JSON.stringify(getAdapter().telemetry())}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          if (interval) clearInterval(interval);
        }
      };
      send();
      interval = setInterval(send, 1000);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
