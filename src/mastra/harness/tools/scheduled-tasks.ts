import { z } from 'zod'
import { createTool } from '@mastra/core/tools'
import { Cron } from 'croner'
import { taskManager } from '../../scheduled-tasks'

export const scheduledTasksTool = createTool({
  id: 'scheduled_tasks',
  description:
    'Manage recurring scheduled tasks. Use action "list" to view, "create" to add, "update" to modify, or "delete" to remove tasks. Requires approval for create/update/delete.',
  inputSchema: z.object({
    action: z.enum(['list', 'create', 'update', 'delete']).describe('The action to perform'),
    id: z.string().optional().describe('Task ID (required for update/delete)'),
    name: z.string().optional().describe('Task name (required for create)'),
    cron: z.string().optional().describe('Cron expression, e.g. "0 9 * * 1-5" for weekdays at 9am (required for create)'),
    prompt: z.string().optional().describe('The instruction prompt that runs when the task fires (required for create)'),
    enabled: z.boolean().optional().describe('Enable or disable the task (for update)'),
  }),
  execute: async ({ action, id, name, cron, prompt, enabled }) => {
    switch (action) {
      case 'list': {
        const tasks = await taskManager.list()
        if (tasks.length === 0) return 'No scheduled tasks found.'
        return tasks
          .map((t) => `- **${t.name}** (${t.id})\n  Cron: \`${t.cron}\` | Enabled: ${t.enabled} | Last run: ${t.lastRunAt || 'never'}\n  Prompt: ${t.prompt.slice(0, 100)}${t.prompt.length > 100 ? '...' : ''}`)
          .join('\n\n')
      }

      case 'create': {
        if (!name) return 'Error: "name" is required for create.'
        if (!cron) return 'Error: "cron" is required for create.'
        if (!prompt) return 'Error: "prompt" is required for create.'

        // Validate cron expression
        try {
          new Cron(cron, { maxRuns: 0 })
        } catch {
          return `Error: Invalid cron expression "${cron}". Use standard 5-field cron format (minute hour day month weekday).`
        }

        const task = await taskManager.create({
          name,
          scheduleConfig: { type: 'custom', cron },
          prompt,
        })

        const next = new Cron(cron).nextRun()
        const nextStr = next ? next.toLocaleString() : 'unknown'
        return `Created scheduled task "${task.name}" (${task.id})\nCron: \`${task.cron}\`\nNext run: ${nextStr}`
      }

      case 'update': {
        if (!id) return 'Error: "id" is required for update.'

        const existing = taskManager.get(id)
        if (!existing) return `Error: Task "${id}" not found.`

        const updates: Record<string, unknown> = {}
        if (name !== undefined) updates.name = name
        if (prompt !== undefined) updates.prompt = prompt
        if (cron !== undefined) {
          try {
            new Cron(cron, { maxRuns: 0 })
          } catch {
            return `Error: Invalid cron expression "${cron}".`
          }
          updates.scheduleConfig = { type: 'custom', cron }
        }

        const task = await taskManager.update(id, updates as any)

        if (enabled !== undefined) {
          await taskManager.toggle(id, enabled)
        }

        return `Updated task "${task.name}" (${task.id})\nCron: \`${task.cron}\` | Enabled: ${enabled ?? task.enabled}`
      }

      case 'delete': {
        if (!id) return 'Error: "id" is required for delete.'

        const existing = taskManager.get(id)
        if (!existing) return `Error: Task "${id}" not found.`

        const taskName = existing.name
        await taskManager.delete(id)
        return `Deleted scheduled task "${taskName}" (${id}).`
      }

      default:
        return `Error: Unknown action "${action}".`
    }
  },
})
