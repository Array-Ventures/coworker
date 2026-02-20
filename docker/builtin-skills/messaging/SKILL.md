---
name: messaging
version: 1.0.0
description: Send messages to users via WhatsApp and other connected channels. Use when asked to notify someone, send a message, reply to a contact, message a group, or proactively communicate through WhatsApp. Supports text, images, documents, audio, video, and stickers. Also provides group etiquette for observing group conversations — use `<no-reply/>` to stay silent when a response is not needed.
tags:
  - messaging
  - whatsapp
  - communication
---

# Messaging

Send messages through connected channels using the `msg` CLI.

## CLI

```bash
# Send a DM
msg send --channel whatsapp --to "+1234567890" "Hello!"

# Send to a group (use the group JID)
msg send --channel whatsapp --to "120363001234@g.us" "Daily summary ready."

# Reply to a specific message
msg send --channel whatsapp --to "+1234567890" --reply-to "MSG_ID" "Got it!"

# Send an image with caption
msg send --channel whatsapp --to "+1234567890" --image /path/to/photo.jpg "Check this out"

# Send a document
msg send --channel whatsapp --to "+1234567890" --file /path/to/report.pdf

# Send a voice note
msg send --channel whatsapp --to "+1234567890" --audio /path/to/voice.ogg --ptt

# Send a video with caption
msg send --channel whatsapp --to "+1234567890" --video /path/to/clip.mp4 "Watch this"

# Send a sticker
msg send --channel whatsapp --to "+1234567890" --sticker /path/to/sticker.webp

# List connected channels and their status
msg channels

# List allowlisted WhatsApp groups
msg groups
```

## Media Flags

| Flag | Description |
|------|-------------|
| `--image <path>` | Send an image (JPEG, PNG, WebP, GIF) |
| `--file <path>` | Send a document (PDF, DOCX, etc.) |
| `--audio <path>` | Send audio (OGG, MP3, M4A) |
| `--video <path>` | Send video (MP4, MOV) |
| `--sticker <path>` | Send a sticker (WebP) |
| `--ptt` | Mark audio as voice note (push-to-talk) |

When using `--image`, `--file`, or `--video`, the text argument becomes the caption.

## `<no-reply/>` Directive

When receiving a group message that does not require a response, output `<no-reply/>` instead of text. The bridge suppresses sending when this directive is present.

**Use `<no-reply/>` when:**
- Message is casual chatter or FYI with no actionable content
- Conversation does not involve you and your input adds no value
- Someone else already answered adequately

**Do NOT use `<no-reply/>` when:**
- You are @mentioned — always respond to direct mentions
- You have genuinely useful information to contribute
- Someone asked a question you can answer

## Group Etiquette

- Keep replies concise and relevant
- Do not send multiple messages in quick succession to the same group
- Wait for a natural pause before contributing to ongoing threads
- Never send sensitive information (passwords, keys, personal data) to groups

## Channels

| Channel  | `--channel` | `--to` format |
|----------|-------------|---------------|
| WhatsApp | `whatsapp`  | `+{number}` (DM) or `{jid}@g.us` (group) |
