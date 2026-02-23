import { z } from 'zod'
import { createTool } from '@mastra/core/tools'
import { requireFilesystem } from '@mastra/core/workspace'

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

/** Emit workspace metadata so the UI can render workspace info */
async function emitWorkspaceMetadata(context: any, toolName: string) {
  const workspace = context?.workspace
  if (!workspace) return
  const info = await workspace.getInfo()
  const toolCallId = context?.agent?.toolCallId
  await context?.writer?.custom({
    type: 'data-workspace-metadata',
    data: { toolName, toolCallId, ...info },
  })
}

export const viewImageTool = createTool({
  id: 'view_image',
  description:
    'View an image file from the workspace as a vision input. Use this instead of read_file for image files (jpg, jpeg, png, gif, webp, bmp) so you can actually see and describe the image contents.',
  inputSchema: z.object({
    path: z.string().describe('The path to the image file to view (e.g., "/workspace/photo.jpg")'),
  }),
  execute: async ({ path }, context) => {
    const { filesystem } = requireFilesystem(context)
    await emitWorkspaceMetadata(context, 'view_image')

    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    if (!IMAGE_EXTENSIONS.has(ext)) {
      return `Error: "${path}" is not a supported image format (${[...IMAGE_EXTENSIONS].join(', ')}). Use read_file for text files.`
    }

    const buffer = await filesystem.readFile(path) // no encoding = raw Buffer
    const stat = await filesystem.stat(path)
    const base64 = Buffer.isBuffer(buffer) ? buffer.toString('base64') : String(buffer)
    const mimeType = MIME_MAP[ext] ?? 'image/png'

    return `${stat.path} (${stat.size} bytes, ${mimeType})\n${base64}`
  },
  toModelOutput: (result: unknown) => {
    if (typeof result !== 'string') return result
    // Parse: "path (N bytes, mime/type)\n{base64}"
    const match = result.match(/^.+?\s+\(\d+ bytes, (image\/\w+)\)\n(.+)$/s)
    if (!match) return result // error message or unexpected format — pass through as text
    // LanguageModelV2ToolResultOutput 'content' variant — the only format
    // that Anthropic/OpenAI adapters convert to actual image content blocks.
    return {
      type: 'content' as const,
      value: [{ type: 'media' as const, data: match[2]!, mediaType: match[1]! }],
    }
  },
})
