import { registerApiRoute } from '@mastra/core/server';
import type { ScheduledTaskManager } from '../scheduled-tasks';

export function scheduledTaskRoutes(taskManager: ScheduledTaskManager) {
  return [
    registerApiRoute('/scheduled-tasks', {
      method: 'GET',
      handler: async (c) => {
        const tasks = await taskManager.list();
        return c.json({ items: tasks });
      },
    }),
    registerApiRoute('/scheduled-tasks', {
      method: 'POST',
      handler: async (c) => {
        const body = await c.req.json();
        if (!body.name || !body.scheduleConfig || !body.prompt) {
          return c.json({ error: 'name, scheduleConfig, and prompt are required' }, 400);
        }
        const task = await taskManager.create(body);
        return c.json(task);
      },
    }),
    registerApiRoute('/scheduled-tasks/:id', {
      method: 'PUT',
      handler: async (c) => {
        const id = c.req.param('id');
        const body = await c.req.json();
        const task = await taskManager.update(id, body);
        return c.json(task);
      },
    }),
    registerApiRoute('/scheduled-tasks/:id', {
      method: 'DELETE',
      handler: async (c) => {
        const id = c.req.param('id');
        await taskManager.delete(id);
        return c.json({ ok: true });
      },
    }),
    registerApiRoute('/scheduled-tasks/:id/toggle', {
      method: 'POST',
      handler: async (c) => {
        const id = c.req.param('id');
        const { enabled } = await c.req.json();
        await taskManager.toggle(id, enabled);
        return c.json({ ok: true });
      },
    }),
  ];
}
