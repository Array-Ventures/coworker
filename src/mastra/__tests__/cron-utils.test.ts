import { describe, expect, test } from 'bun:test';
import { toCron, describeSchedule, type ScheduleConfig } from '../cron-utils';

describe('toCron', () => {
  test('daily at default time', () => {
    expect(toCron({ type: 'daily' })).toBe('0 9 * * *');
  });

  test('daily at specific time', () => {
    expect(toCron({ type: 'daily', hour: 14, minute: 30 })).toBe('30 14 * * *');
  });

  test('daily at midnight', () => {
    expect(toCron({ type: 'daily', hour: 0, minute: 0 })).toBe('0 0 * * *');
  });

  test('weekly defaults to Monday at 09:00', () => {
    expect(toCron({ type: 'weekly' })).toBe('0 9 * * 1');
  });

  test('weekly on Friday at 17:00', () => {
    expect(toCron({ type: 'weekly', dayOfWeek: 5, hour: 17, minute: 0 })).toBe('0 17 * * 5');
  });

  test('weekly on Sunday', () => {
    expect(toCron({ type: 'weekly', dayOfWeek: 0 })).toBe('0 9 * * 0');
  });

  test('monthly defaults to 1st at 09:00', () => {
    expect(toCron({ type: 'monthly' })).toBe('0 9 1 * *');
  });

  test('monthly on 15th at 08:30', () => {
    expect(toCron({ type: 'monthly', dayOfMonth: 15, hour: 8, minute: 30 })).toBe('30 8 15 * *');
  });

  test('custom cron expression', () => {
    expect(toCron({ type: 'custom', cron: '*/5 * * * *' })).toBe('*/5 * * * *');
  });

  test('custom without cron expression throws', () => {
    expect(() => toCron({ type: 'custom' })).toThrow('Custom schedule requires a cron expression');
  });

  test('once uses daily cron at specified time', () => {
    expect(toCron({ type: 'once', hour: 10, minute: 15 })).toBe('15 10 * * *');
  });

  test('unknown type throws', () => {
    expect(() => toCron({ type: 'invalid' as any })).toThrow('Unknown schedule type');
  });
});

describe('describeSchedule', () => {
  test('daily at default time', () => {
    expect(describeSchedule({ type: 'daily' })).toBe('Daily at 09:00');
  });

  test('daily at specific time', () => {
    expect(describeSchedule({ type: 'daily', hour: 14, minute: 5 })).toBe('Daily at 14:05');
  });

  test('weekly defaults to Mon', () => {
    expect(describeSchedule({ type: 'weekly' })).toBe('Every Mon at 09:00');
  });

  test('weekly on Friday', () => {
    expect(describeSchedule({ type: 'weekly', dayOfWeek: 5, hour: 17, minute: 0 })).toBe('Every Fri at 17:00');
  });

  test('monthly defaults to day 1', () => {
    expect(describeSchedule({ type: 'monthly' })).toBe('Monthly on day 1 at 09:00');
  });

  test('monthly on 15th', () => {
    expect(describeSchedule({ type: 'monthly', dayOfMonth: 15, hour: 8, minute: 30 })).toBe('Monthly on day 15 at 08:30');
  });

  test('custom shows cron expression', () => {
    expect(describeSchedule({ type: 'custom', cron: '*/5 * * * *' })).toBe('Custom: */5 * * * *');
  });

  test('once with date', () => {
    expect(describeSchedule({ type: 'once', date: '2026-03-01', hour: 10, minute: 0 })).toBe('Once on 2026-03-01 at 10:00');
  });

  test('once without date', () => {
    expect(describeSchedule({ type: 'once', hour: 10, minute: 0 })).toBe('Once at 10:00');
  });

  test('unknown type', () => {
    expect(describeSchedule({ type: 'invalid' as any })).toBe('Unknown schedule');
  });
});
