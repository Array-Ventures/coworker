import { registerApiRoute } from '@mastra/core/server';

const STREAM_PORT = process.env.AGENT_BROWSER_STREAM_PORT || '9223';

/**
 * SSE + POST proxy: renderer ↔ Mastra server ↔ agent-browser daemon.
 *
 * The renderer can't reach ws://localhost:9223 directly when the server is
 * remote (Railway). This proxy sits on the same Hono server so the renderer
 * connects via HTTP to the same origin.
 *
 * GET  /browser-stream       — SSE stream of frames (server → client)
 * POST /browser-stream/input — Forward mouse/keyboard events (client → server)
 */

// Each SSE client gets its own upstream WebSocket. We track them by a simple
// incrementing ID so the input endpoint can find the right connection.
let nextId = 0;
const upstreams = new Map<number, WebSocket>();

function connectUpstream(clientId: number, controller: ReadableStreamDefaultController<Uint8Array>) {
  const encoder = new TextEncoder();
  const ws = new WebSocket(`ws://localhost:${STREAM_PORT}`);

  ws.onopen = () => {
    upstreams.set(clientId, ws);
    controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`));
  };

  ws.onmessage = (e) => {
    try {
      const raw = typeof e.data === 'string' ? e.data : '';
      controller.enqueue(encoder.encode(`event: frame\ndata: ${raw}\n\n`));
    } catch {
      // client disconnected — stream controller closed
    }
  };

  ws.onclose = () => {
    upstreams.delete(clientId);
    try {
      controller.enqueue(encoder.encode(`event: closed\ndata: {}\n\n`));
      controller.close();
    } catch {
      // already closed
    }
  };

  ws.onerror = () => {
    upstreams.delete(clientId);
    try {
      controller.enqueue(encoder.encode(`event: error\ndata: {}\n\n`));
      controller.close();
    } catch {
      // already closed
    }
  };

  return ws;
}

export const browserStreamRoutes = [
  /**
   * SSE endpoint — streams frames from agent-browser's WebSocket to the client.
   * Each connection gets its own upstream WebSocket.
   */
  registerApiRoute('/browser-stream', {
    method: 'GET',
    handler: async (c) => {
      const clientId = nextId++;
      let upstream: WebSocket | null = null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          upstream = connectUpstream(clientId, controller);
        },
        cancel() {
          upstream?.close();
          upstreams.delete(clientId);
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Browser-Stream-Client': String(clientId),
        },
      });
    },
  }),

  /**
   * Input forwarding — receives mouse/keyboard events and sends them to
   * the upstream agent-browser WebSocket.
   */
  registerApiRoute('/browser-stream/input', {
    method: 'POST',
    handler: async (c) => {
      const body = await c.req.json();
      const clientId = body.clientId as number | undefined;

      // Find the upstream — prefer specific clientId, fall back to first active
      let ws: WebSocket | undefined;
      if (clientId !== undefined) {
        ws = upstreams.get(clientId);
      }
      if (!ws) {
        // Fall back to the most recent upstream connection
        const entries = [...upstreams.values()];
        ws = entries[entries.length - 1];
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return c.json({ ok: false, error: 'No active browser stream' }, 503);
      }

      ws.send(JSON.stringify(body));
      return c.json({ ok: true });
    },
  }),
];
