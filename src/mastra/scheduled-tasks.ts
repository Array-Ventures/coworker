import type { Mastra } from '@mastra/core/mastra';
import { Cron } from 'croner';
import { readJsonConfig, writeJsonConfig } from './config/fs-config';
import { createTaskWorkflow } from './workflows/scheduled-task';
import { toCron, type ScheduleConfig } from './cron-utils';

const TASKS_FILE = 'scheduled-tasks.json';

export interface ScheduledTask {
  id: string;
  name: string;
  scheduleType: string;
  cron: string;
  scheduleConfig: string;
  prompt: string;
  notify: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
}

interface TasksFile {
  tasks: ScheduledTask[];
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

export class ScheduledTaskManager {
  private mastra!: Mastra;
  private cronJobs = new Map<string, Cron>();

  setMastra(mastra: Mastra) {
    this.mastra = mastra;
  }

  private readTasks(): ScheduledTask[] {
    return readJsonConfig<TasksFile>(TASKS_FILE, { tasks: [] }).tasks;
  }

  private writeTasks(tasks: ScheduledTask[]): void {
    writeJsonConfig(TASKS_FILE, { tasks });
  }

  async init(): Promise<void> {
    this.seedDefaults();

    const tasks = this.readTasks();
    for (const task of tasks) {
      if (!task.enabled) continue;
      const workflow = createTaskWorkflow(task.id);
      this.mastra.addWorkflow(workflow);
      this.scheduleCron(task);
    }
  }

  private seedDefaults(): void {
    const tasks = this.readTasks();
    if (tasks.some((t) => t.id === 'heartbeat')) return;

    const prompt = `TRIGGER: Scheduled heartbeat
No one messaged you. The system woke you up on schedule.

This is your time. You can:
- Review recent conversations and update your working memory
- Work on projects you've been thinking about
- Research something that interests you
- Continue multi-step work from previous heartbeats
- Check workspace files for changes`;

    const config: ScheduleConfig = { type: 'custom', cron: '*/30 * * * *' };
    const now = new Date().toISOString();

    tasks.push({
      id: 'heartbeat',
      name: 'Heartbeat',
      scheduleType: 'custom',
      cron: '*/30 * * * *',
      scheduleConfig: JSON.stringify(config),
      prompt,
      notify: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
    });
    this.writeTasks(tasks);
  }

  private scheduleCron(task: ScheduledTask): void {
    // Stop existing job if any
    this.cronJobs.get(task.id)?.stop();

    const job = new Cron(task.cron, async () => {
      await this.executeTask(task.id);
    });
    this.cronJobs.set(task.id, job);
    console.log(`[scheduled-task] scheduled "${task.name}" with cron: ${task.cron}`);
  }

  private async executeTask(taskId: string): Promise<void> {
    const task = this.get(taskId);
    if (!task || !task.enabled) return;

    console.log(`[scheduled-task] executing "${task.name}" (${taskId})`);

    try {
      const workflow = this.mastra.getWorkflow(`scheduled-task-${taskId}`);
      const run = await workflow.createRun();
      await run.start({
        inputData: { prompt: task.prompt, taskId, taskName: task.name },
      });

      // Update lastRunAt
      const tasks = this.readTasks();
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx >= 0) {
        tasks[idx].lastRunAt = new Date().toISOString();
        this.writeTasks(tasks);
      }
    } catch (err) {
      console.error(`[scheduled-task] "${task.name}" failed:`, err instanceof Error ? err.message : err);
    }
  }

  async list(): Promise<ScheduledTask[]> {
    return this.readTasks().sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  get(id: string): ScheduledTask | null {
    return this.readTasks().find((t) => t.id === id) ?? null;
  }

  async create(input: CreateTaskInput): Promise<ScheduledTask> {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cron = toCron(input.scheduleConfig);
    const now = new Date().toISOString();

    const task: ScheduledTask = {
      id,
      name: input.name,
      scheduleType: input.scheduleConfig.type,
      cron,
      scheduleConfig: JSON.stringify(input.scheduleConfig),
      prompt: input.prompt,
      notify: input.notify !== false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
    };

    const tasks = this.readTasks();
    tasks.push(task);
    this.writeTasks(tasks);

    const workflow = createTaskWorkflow(id);
    this.mastra.addWorkflow(workflow);
    this.scheduleCron(task);

    return task;
  }

  async update(id: string, data: UpdateTaskInput): Promise<ScheduledTask> {
    const tasks = this.readTasks();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Task ${id} not found`);

    const task = tasks[idx];
    if (data.name !== undefined) task.name = data.name;
    if (data.prompt !== undefined) task.prompt = data.prompt;
    if (data.notify !== undefined) task.notify = data.notify;
    if (data.scheduleConfig !== undefined) {
      task.scheduleType = data.scheduleConfig.type;
      task.cron = toCron(data.scheduleConfig);
      task.scheduleConfig = JSON.stringify(data.scheduleConfig);
    }
    task.updatedAt = new Date().toISOString();
    this.writeTasks(tasks);

    // Re-register workflow and reschedule if schedule or prompt changed
    if (data.scheduleConfig || data.prompt) {
      if (task.enabled) {
        const workflow = createTaskWorkflow(id);
        this.mastra.addWorkflow(workflow);
        this.scheduleCron(task);
      }
    }

    return task;
  }

  async delete(id: string): Promise<void> {
    const tasks = this.readTasks().filter((t) => t.id !== id);
    this.writeTasks(tasks);
    this.cronJobs.get(id)?.stop();
    this.cronJobs.delete(id);
  }

  async toggle(id: string, enabled: boolean): Promise<void> {
    const tasks = this.readTasks();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Task ${id} not found`);

    tasks[idx].enabled = enabled;
    tasks[idx].updatedAt = new Date().toISOString();
    this.writeTasks(tasks);

    if (enabled) {
      const task = tasks[idx];
      const workflow = createTaskWorkflow(id);
      this.mastra.addWorkflow(workflow);
      this.scheduleCron(task);
    } else {
      this.cronJobs.get(id)?.stop();
      this.cronJobs.delete(id);
    }
  }
}
