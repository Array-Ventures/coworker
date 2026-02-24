import { registerApiRoute } from '@mastra/core/server';

const STREAM_PORT = process.env.AGENT_BROWSER_STREAM_PORT || '9223';
const UPSTREAM_RECONNECT_MS = 2000;

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

let nextId = 0;
const upstreams = new Map<number, WebSocket>();

interface StreamClient {
  clientId: number;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  alive: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

function send(client: StreamClient, event: string, data: string) {
  try {
    client.controller.enqueue(client.encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
  } catch {
    // stream closed
  }
}

function connectUpstream(client: StreamClient) {
  if (!client.alive) return;

  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://localhost:${STREAM_PORT}`);
  } catch {
    // agent-browser not running — retry later
    scheduleReconnect(client);
    return;
  }

  ws.onopen = () => {
    console.log(`[browser-stream] upstream connected for client ${client.clientId}`);
    upstreams.set(client.clientId, ws);
    send(client, 'connected', JSON.stringify({ clientId: client.clientId }));
  };

  ws.onmessage = (e) => {
    const raw = typeof e.data === 'string' ? e.data : '';
    console.log(`[browser-stream] upstream msg: ${raw.slice(0, 200)}`);
    send(client, 'frame', raw);
  };

  ws.onclose = () => {
    console.log(`[browser-stream] upstream closed for client ${client.clientId}`);
    upstreams.delete(client.clientId);
    scheduleReconnect(client);
  };

  ws.onerror = () => {
    console.log(`[browser-stream] upstream error for client ${client.clientId}`);
    upstreams.delete(client.clientId);
    // onclose fires after onerror — reconnect happens there
  };
}

function scheduleReconnect(client: StreamClient) {
  if (!client.alive) return;
  if (client.reconnectTimer) return; // already scheduled
  client.reconnectTimer = setTimeout(() => {
    client.reconnectTimer = null;
    connectUpstream(client);
  }, UPSTREAM_RECONNECT_MS);
}

function cleanupClient(client: StreamClient) {
  client.alive = false;
  if (client.reconnectTimer) {
    clearTimeout(client.reconnectTimer);
    client.reconnectTimer = null;
  }
  const ws = upstreams.get(client.clientId);
  if (ws) {
    ws.onclose = null; // prevent reconnect from close handler
    ws.close();
    upstreams.delete(client.clientId);
  }
}

export const browserStreamRoutes = [
  registerApiRoute('/browser-stream', {
    method: 'GET',
    handler: async (c) => {
      const clientId = nextId++;

      const client: StreamClient = {
        clientId,
        controller: null as any, // set in start()
        encoder: new TextEncoder(),
        alive: true,
        reconnectTimer: null,
      };

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          client.controller = controller;
          connectUpstream(client);
        },
        cancel() {
          cleanupClient(client);
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    },
  }),

  registerApiRoute('/browser-stream/input', {
    method: 'POST',
    handler: async (c) => {
      const body = await c.req.json();
      const clientId = body.clientId as number | undefined;

      let ws: WebSocket | undefined;
      if (clientId !== undefined) {
        ws = upstreams.get(clientId);
      }
      if (!ws) {
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
