/**
 * Parsers for special user message formats (system reminders, channel context, observe mode).
 * Used by MessageBubble to detect and route to specialized renderers.
 */

/** Check if entire message is a <system-reminder> */
export function parseSystemReminder(text: string): string | null {
  const match = text.trim().match(/^<system-reminder>([\s\S]*?)<\/system-reminder>$/)
  return match ? match[1].trim() : null
}

export interface ChannelContext {
  channel: string
  type: string
  senderName?: string
  senderJid?: string
  groupName?: string
  timestamp?: string
  mentioned?: boolean
  quoted?: string
  observeMode?: boolean
  attachment?: { type: string; mimeType: string; size?: string; fileName?: string }
  body: string
}

/**
 * Parse <message-context> envelope and extract the actual message body.
 * Also handles <observe-mode> wrapping around the envelope.
 */
export function parseMessageContext(text: string): ChannelContext | null {
  let input = text
  let observeMode = false

  // Strip <observe-mode> wrapper if present
  const obsMatch = input.match(/^<observe-mode>[\s\S]*?<\/observe-mode>\s*([\s\S]*)$/)
  if (obsMatch) {
    observeMode = true
    input = obsMatch[1]
  }

  const match = input.match(/^<message-context>\s*([\s\S]*?)\s*<\/message-context>\s*([\s\S]*)$/)
  if (!match) return null

  const xml = match[1]
  let body = match[2].trim()

  const channel = xml.match(/<channel>(.*?)<\/channel>/)?.[1] ?? ''
  const type = xml.match(/<type>(.*?)<\/type>/)?.[1] ?? ''
  const senderMatch = xml.match(/<sender\s+(?:name="([^"]*)"\s+)?jid="([^"]*)"/)
  const senderName = senderMatch?.[1]
  const senderJid = senderMatch?.[2]
  const groupMatch = xml.match(/<group\s+name="([^"]*)"/)
  const groupName = groupMatch?.[1]
  const timestamp = xml.match(/<timestamp>(.*?)<\/timestamp>/)?.[1]
  const mentioned = xml.includes('<mentioned>true</mentioned>')
  const quotedMatch = xml.match(/<quoted>([\s\S]*?)<\/quoted>/)
  const quoted = quotedMatch?.[1]

  // Parse attachment metadata
  let attachment: ChannelContext['attachment']
  const attMatch = xml.match(/<attachment\s+([^>]*)\/>/)
  if (attMatch) {
    const attrs = attMatch[1]
    attachment = {
      type: attrs.match(/type="([^"]*)"/)?.[1] ?? '',
      mimeType: attrs.match(/mimeType="([^"]*)"/)?.[1] ?? '',
      size: attrs.match(/size="([^"]*)"/)?.[1],
      fileName: attrs.match(/fileName="([^"]*)"/)?.[1],
    }
  }

  // Strip [Attachment: ...] lines from body (already shown in attachment chip)
  if (attachment) {
    body = body.replace(/\n?\[Attachment:.*?\]/g, '').trim()
  }

  return {
    channel, type, senderName, senderJid, groupName,
    timestamp, mentioned, quoted, observeMode, attachment, body,
  }
}
