import { bearerAuth } from 'hono/bearer-auth';
import { createMiddleware } from 'hono/factory';

/**
 * Creates auth middleware that protects all routes when COWORKER_API_TOKEN is set.
 * Uses Hono bearerAuth instead of Mastra's SimpleAuth because Mastra's
 * checkRouteAuth passes null as the request to authenticateToken() on
 * built-in routes (/api/memory/*, /api/agents/*), crashing SimpleAuth.
 */
export function createAuthMiddleware() {
  const token = process.env.COWORKER_API_TOKEN;

  if (!token) {
    return createMiddleware(async (_c, next) => next());
  }

  return createMiddleware(async (c, next) => {
    const path = c.req.path;
    if (path === '/health') return next();

    const playgroundToken = c.req.header('X-Playground-Access');
    if (playgroundToken === token) return next();

    return bearerAuth({ token })(c, next);
  });
}
