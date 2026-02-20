---
name: Messaging
description: Send messages to users via WhatsApp and other connected channels. Use when asked to notify someone, send a message, reply to a contact, message a group, or proactively communicate through WhatsApp. Also provides group etiquette for observing group conversations — use `<no-reply/>` to stay silent when a response is not needed.
---

# Messaging

Send messages through connected channels using the `msg` CLI at `/.agents/skills/messaging/scripts/msg`.

## CLI

```bash
# Send a DM
/.agents/skills/messaging/scripts/msg send --channel whatsapp --to "+1234567890" "Hello!"

# Send to a group (use the group JID)
/.agents/skills/messaging/scripts/msg send --channel whatsapp --to "120363001234@g.us" "Daily summary ready."

# Reply to a specific message
/.agents/skills/messaging/scripts/msg send --channel whatsapp --to "+1234567890" --reply-to "MSG_ID" "Got it!"

# List connected channels and their status
/.agents/skills/messaging/scripts/msg channels

# List allowlisted WhatsApp groups
/.agents/skills/messaging/scripts/msg groups
```

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
