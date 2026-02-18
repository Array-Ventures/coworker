import type { Mastra } from '@mastra/core/mastra';
import { pool } from './db';
import { createTaskWorkflow } from './workflows/scheduled-task';
import { toCron, type ScheduleConfig } from './cron-utils';

export interface ScheduledTask {
  id: string;
  name: string;
  scheduleType: string;
  cron: string;
  scheduleConfig: ScheduleConfig | null;
  prompt: string;
  notify: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
}

export interface CreateTaskInput {
  name: string;
  scheduleConfig: ScheduleConfig;
  prompt: string;
  notify?: boolean;
}

export interface UpdateTaskInput {
  name?: string;
  scheduleConfig?: ScheduleConfig;
  prompt?: string;
  notify?: boolean;
}

function rowToTask(row: Record<string, any>): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    scheduleType: row.schedule_type,
    cron: row.cron,
    scheduleConfig: row.schedule_config ? JSON.parse(row.schedule_config) : null,
    prompt: row.prompt,
    notify: row.notify === true,
    enabled: row.enabled === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
  };
}

export class ScheduledTaskManager {
  private mastra!: Mastra;

  setMastra(mastra: Mastra) {
    this.mastra = mastra;
  }

  async init(): Promise<void> {
    await this.seedDefaults();

    const result = await pool.query(
      'SELECT * FROM scheduled_tasks WHERE enabled = TRUE',
    );
    for (const row of result.rows) {
      const task = rowToTask(row as Record<string, any>);
      const workflow = createTaskWorkflow(task.id, task.cron, task.prompt, task.name);
      this.mastra.addWorkflow(workflow);
    }
  }

  private async seedDefaults(): Promise<void> {
    const existing = await pool.query(
      'SELECT id FROM scheduled_tasks WHERE id = $1',
      ['heartbeat'],
    );
    if (existing.rows.length > 0) return;

    const prompt = `TRIGGER: Scheduled heartbeat
No one messaged you. The system woke you up on schedule.

This is your time. You can:
- Review recent conversations and update your working memory
- Work on projects you've been thinking about
- Research something that interests you
- Continue multi-step work from previous heartbeats
- Check workspace files for changes`;

    const config: ScheduleConfig = { type: 'custom', cron: '*/30 * * * *' };

    await pool.query(
      `INSERT INTO scheduled_tasks (id, name, schedule_type, cron, schedule_config, prompt, notify, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['heartbeat', 'Heartbeat', 'custom', '*/30 * * * *', JSON.stringify(config), prompt, false, true],
    );
  }

  async list(): Promise<ScheduledTask[]> {
    const result = await pool.query(
      'SELECT * FROM scheduled_tasks ORDER BY created_at DESC',
    );
    return result.rows.map((row) => rowToTask(row as Record<string, any>));
  }

  async get(id: string): Promise<ScheduledTask | null> {
    const result = await pool.query(
      'SELECT * FROM scheduled_tasks WHERE id = $1',
      [id],
    );
    if (result.rows.length === 0) return null;
    return rowToTask(result.rows[0] as Record<string, any>);
  }

  async create(input: CreateTaskInput): Promise<ScheduledTask> {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cron = toCron(input.scheduleConfig);

    await pool.query(
      `INSERT INTO scheduled_tasks (id, name, schedule_type, cron, schedule_config, prompt, notify)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        input.name,
        input.scheduleConfig.type,
        cron,
        JSON.stringify(input.scheduleConfig),
        input.prompt,
        input.notify !== false,
      ],
    );

    const workflow = createTaskWorkflow(id, cron, input.prompt, input.name);
    this.mastra.addWorkflow(workflow);

    return (await this.get(id))!;
  }

  async update(id: string, data: UpdateTaskInput): Promise<ScheduledTask> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Task ${id} not found`);

    const sets: string[] = [];
    const args: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      sets.push(`name = $${paramIndex++}`);
      args.push(data.name);
    }
    if (data.prompt !== undefined) {
      sets.push(`prompt = $${paramIndex++}`);
      args.push(data.prompt);
    }
    if (data.notify !== undefined) {
      sets.push(`notify = $${paramIndex++}`);
      args.push(data.notify);
    }
    if (data.scheduleConfig !== undefined) {
      const cron = toCron(data.scheduleConfig);
      sets.push(`schedule_type = $${paramIndex++}`, `cron = $${paramIndex++}`, `schedule_config = $${paramIndex++}`);
      args.push(data.scheduleConfig.type, cron, JSON.stringify(data.scheduleConfig));
    }

    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      args.push(id);
      await pool.query(
        `UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = $${paramIndex}`,
        args,
      );
    }

    // Re-register workflow with updated config if schedule or prompt changed
    if (data.scheduleConfig || data.prompt) {
      const updated = await this.get(id);
      if (updated && updated.enabled) {
        const workflow = createTaskWorkflow(id, updated.cron, updated.prompt, updated.name);
        this.mastra.addWorkflow(workflow);
      }
    }

    return (await this.get(id))!;
  }

  async delete(id: string): Promise<void> {
    await pool.query(
      'DELETE FROM scheduled_tasks WHERE id = $1',
      [id],
    );
    // Workflow remains in mastra memory until restart, but won't re-register on next boot
  }

  async toggle(id: string, enabled: boolean): Promise<void> {
    await pool.query(
      'UPDATE scheduled_tasks SET enabled = $1, updated_at = NOW() WHERE id = $2',
      [enabled, id],
    );

    if (enabled) {
      const task = await this.get(id);
      if (task) {
        const workflow = createTaskWorkflow(id, task.cron, task.prompt, task.name);
        this.mastra.addWorkflow(workflow);
      }
    }
    // When disabling: workflow stays in memory but will be excluded on restart
  }
}
