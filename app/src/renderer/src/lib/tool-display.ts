const HIDDEN_TOOLS = new Set(['task_write', 'task_check'])

export function isHiddenTool(toolName: string): boolean {
  return HIDDEN_TOOLS.has(toolName)
}

type ToolMeta = {
  displayName: string
  icon: string
  primaryArg: string
}

const WORKSPACE_TOOLS: Record<string, ToolMeta> = {
  mastra_workspace_execute_command: { displayName: 'Execute Command', icon: 'terminal', primaryArg: 'command' },
  mastra_workspace_read_file: { displayName: 'Read File', icon: 'description', primaryArg: 'path' },
  mastra_workspace_write_file: { displayName: 'Write File', icon: 'edit_note', primaryArg: 'path' },
  mastra_workspace_edit_file: { displayName: 'Edit File', icon: 'edit', primaryArg: 'path' },
  mastra_workspace_list_files: { displayName: 'List Files', icon: 'folder', primaryArg: 'path' },
  mastra_workspace_delete: { displayName: 'Delete', icon: 'delete', primaryArg: 'path' },
  mastra_workspace_mkdir: { displayName: 'Make Directory', icon: 'create_new_folder', primaryArg: 'path' },
  mastra_workspace_file_stat: { displayName: 'File Info', icon: 'info', primaryArg: 'path' },
  view_app: { displayName: 'View App', icon: 'web', primaryArg: 'name' },
  searchMemory: { displayName: 'Search Memory', icon: 'neurology', primaryArg: 'query' },
  view_image: { displayName: 'View Image', icon: 'image', primaryArg: 'path' },
}

export function getToolDisplay(toolName: string): ToolMeta {
  if (WORKSPACE_TOOLS[toolName]) return WORKSPACE_TOOLS[toolName]
  const short = toolName.replace(/^mastra_workspace_/, '').replace(/_/g, ' ')
  const display = short.replace(/\b\w/g, (c) => c.toUpperCase())
  return { displayName: display, icon: 'build', primaryArg: '' }
}

export function getPrimaryArgValue(toolName: string, args: unknown): string | null {
  const meta = WORKSPACE_TOOLS[toolName]
  if (!meta?.primaryArg || !args || typeof args !== 'object') return null
  const val = (args as Record<string, unknown>)[meta.primaryArg]
  return typeof val === 'string' ? val : null
}

export function getExecutionTime(output: unknown): number | null {
  if (!output || typeof output !== 'object') return null
  const ms = (output as Record<string, unknown>).executionTimeMs
  return typeof ms === 'number' ? ms : null
}

export function formatToolOutput(
  toolName: string,
  output: unknown,
): { type: 'text' | 'pre'; content: string } | null {
  if (!output) return null
  if (typeof output === 'string') return { type: 'pre', content: output.trim() || '(no output)' }
  if (typeof output !== 'object') return { type: 'pre', content: String(output) }
  const o = output as Record<string, unknown>

  if (toolName === 'mastra_workspace_execute_command') {
    const stdout = ((o.stdout as string) || '').trim()
    const stderr = ((o.stderr as string) || '').trim()
    const text = stdout || stderr || '(no output)'
    return { type: 'pre', content: text }
  }

  if (toolName === 'mastra_workspace_list_files') {
    const tree = ((o.tree as string) || '').trim()
    const summary = (o.summary as string) || ''
    return { type: 'pre', content: tree + (summary ? '\n' + summary : '') }
  }

  if (toolName === 'mastra_workspace_read_file') {
    const content = ((o.content as string) || '').trim()
    return { type: 'pre', content: content || '(empty file)' }
  }

  if (toolName === 'searchMemory') {
    return null // handled by custom SearchMemoryOutput component
  }

  if (toolName === 'view_image') {
    return null // handled by custom image render in ToolInvocation
  }

  return { type: 'pre', content: JSON.stringify(o, null, 2) }
}
