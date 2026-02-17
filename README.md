# Coworker

AI team member built with [Mastra](https://mastra.ai). Handles tasks, answers questions, and manages workflows via chat.

## Stack

- **Backend**: Mastra agents + tools (TypeScript)
- **Desktop**: Electron app (React + Tailwind)
- **Integrations**: WhatsApp, Google Workspace (gog CLI), MCP
- **Scheduling**: Inngest
- **Runtime**: Bun

## Setup

### Backend

```bash
cp .env.example .env   # add your API keys
bun install
bun run dev            # http://localhost:4111
```

### Desktop App

```bash
cd app && bun install && bun run dev
```

The app connects to `http://localhost:4111` by default. To connect to a remote Mastra server, go to **Settings > Advanced** and update the Server URL.

## Docker

```bash
docker compose up
```

Builds are automated via GitHub Actions and pushed to `ghcr.io`.

## Auto-Updates

The desktop app supports automatic updates via GitHub Releases. When a new release is published, users are notified in **Settings > Advanced** where they can download and install the update.

Releases are built via the GitHub Actions workflow — push a version tag or trigger the workflow manually.

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
