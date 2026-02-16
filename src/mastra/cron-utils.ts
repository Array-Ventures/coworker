export type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';

export interface ScheduleConfig {
  type: ScheduleType;
  hour?: number;
  minute?: number;
  dayOfWeek?: number; // 0=Sun, 1=Mon, ..., 6=Sat
  dayOfMonth?: number; // 1-31
  date?: string; // ISO date for 'once' type
  cron?: string; // raw cron for 'custom' type
}

export function toCron(config: ScheduleConfig): string {
  const min = config.minute ?? 0;
  const hour = config.hour ?? 9;

  switch (config.type) {
    case 'daily':
      return `${min} ${hour} * * *`;
    case 'weekly':
      return `${min} ${hour} * * ${config.dayOfWeek ?? 1}`;
    case 'monthly':
      return `${min} ${hour} ${config.dayOfMonth ?? 1} * *`;
    case 'custom':
      if (!config.cron) throw new Error('Custom schedule requires a cron expression');
      return config.cron;
    case 'once':
      // For "once" tasks, we use a daily cron at the specified time.
      // The task manager disables the task after first execution.
      return `${min} ${hour} * * *`;
    default:
      throw new Error(`Unknown schedule type: ${config.type}`);
  }
}

export function describeSchedule(config: ScheduleConfig): string {
  const time = `${String(config.hour ?? 9).padStart(2, '0')}:${String(config.minute ?? 0).padStart(2, '0')}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  switch (config.type) {
    case 'daily':
      return `Daily at ${time}`;
    case 'weekly':
      return `Every ${days[config.dayOfWeek ?? 1]} at ${time}`;
    case 'monthly':
      return `Monthly on day ${config.dayOfMonth ?? 1} at ${time}`;
    case 'custom':
      return `Custom: ${config.cron}`;
    case 'once':
      return config.date ? `Once on ${config.date} at ${time}` : `Once at ${time}`;
    default:
      return 'Unknown schedule';
  }
}
