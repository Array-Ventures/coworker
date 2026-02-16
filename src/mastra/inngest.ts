import { realtimeMiddleware } from '@inngest/realtime/middleware';
import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'coworker',
  baseUrl: process.env.INNGEST_BASE_URL || 'http://localhost:8288',
  isDev: process.env.INNGEST_DEV !== '0',
  middleware: [realtimeMiddleware()],
});
