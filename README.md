# Coworker

AI team member built with [Mastra](https://mastra.ai). Handles tasks, answers questions, and manages workflows via chat.

## Stack

- **Backend**: Mastra agents + tools (TypeScript)
- **Desktop**: Electron app (React + Tailwind)
- **Integrations**: WhatsApp, Google Workspace (gog CLI), MCP
- **Scheduling**: Inngest
- **Runtime**: Bun

## Setup

```bash
cp .env.example .env   # add your API keys
bun install
bun run dev            # http://localhost:4111
```

Desktop app:

```bash
cd app && bun install && bun run dev
```

## Docker

```bash
docker compose up
```

Builds are automated via GitHub Actions and pushed to `ghcr.io`.

## Project Structure

```
src/mastra/
  agents/       # Agent definitions
  tools/        # Reusable tools
  workflows/    # Scheduled tasks
  gog/          # Google Workspace integration
  whatsapp/     # WhatsApp bridge
  mcp/          # MCP server
app/            # Electron desktop app
```
