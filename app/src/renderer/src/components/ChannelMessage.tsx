import type { HarnessMessageContent } from '../types/harness'
import type { ChannelContext } from '../lib/message-parsers'

type ImageContent = Extract<HarnessMessageContent, { type: 'image' }>

const CHANNEL_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  whatsapp: { icon: 'chat', label: 'WhatsApp', color: 'text-success' },
  email: { icon: 'mail', label: 'Email', color: 'text-primary' },
  api: { icon: 'api', label: 'API', color: 'text-warning' },
  scheduled: { icon: 'schedule', label: 'Scheduled', color: 'text-muted-foreground' },
}

/** External channel message with sender badge (WhatsApp, email, API, scheduled) */
export function ChannelMessage({ ctx, images }: {
  ctx: ChannelContext
  images: ImageContent[]
}) {
  const cfg = CHANNEL_CONFIG[ctx.channel] ?? { icon: 'forum', label: ctx.channel, color: 'text-muted-foreground' }

  return (
    <div className="flex justify-end">
      <div className={`flex flex-col bg-card border border-border rounded-[14px] overflow-hidden${ctx.observeMode ? ' opacity-60' : ''}`}>
        {/* Channel + sender header */}
        <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-1">
          <span className={`material-icon ${cfg.color} shrink-0`} style={{ fontSize: 13 }}>{cfg.icon}</span>
          <span className={`font-secondary text-[11px] font-semibold ${cfg.color}`}>{cfg.label}</span>
          {ctx.senderName && (
            <>
              <span className="text-muted-dim font-secondary text-[11px]">·</span>
              <span className="font-secondary text-[12px] text-muted-foreground">{ctx.senderName}</span>
            </>
          )}
          {ctx.type === 'group' && ctx.groupName && (
            <>
              <span className="font-secondary text-[11px] text-muted-dim">in</span>
              <span className="font-secondary text-[12px] text-muted-foreground">{ctx.groupName}</span>
            </>
          )}
          {ctx.observeMode && (
            <>
              <span className="text-muted-dim font-secondary text-[11px]">·</span>
              <span className="font-secondary text-[10px] text-muted-foreground italic font-semibold">observed</span>
            </>
          )}
        </div>

        {/* Quoted message */}
        {ctx.quoted && (
          <div className="flex gap-2 mx-4 mt-1 mb-0.5">
            <div className="w-0.5 shrink-0 rounded-full bg-muted-dim" />
            <span className="font-secondary text-[12px] text-muted-foreground italic leading-relaxed">{ctx.quoted}</span>
          </div>
        )}

        {/* Message body */}
        <div className="text-[15px] leading-relaxed whitespace-pre-wrap font-secondary px-4 pb-3 pt-0.5">
          {images.map((img, i) => (
            <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="upload" className="max-w-[300px] rounded-lg mb-2" />
          ))}
          {ctx.body}
        </div>

        {/* Attachment metadata */}
        {ctx.attachment && (
          <div className="flex items-center gap-1.5 px-4 pb-3 -mt-1">
            <span className="material-icon text-muted-foreground" style={{ fontSize: 14 }}>
              {ctx.attachment.type === 'image' ? 'image' : ctx.attachment.type === 'video' ? 'videocam' : ctx.attachment.type === 'audio' ? 'audio_file' : 'attach_file'}
            </span>
            <span className="font-secondary text-[12px] text-muted-foreground">
              {ctx.attachment.mimeType}
              {ctx.attachment.size && ` · ${Math.round(Number(ctx.attachment.size) / 1024)} KB`}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
