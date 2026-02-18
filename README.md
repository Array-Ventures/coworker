# Coworker

Open-source AI agent built with [Mastra](https://mastra.ai). Acts as an AI team member that handles tasks, answers questions, and manages workflows via chat. Supports OpenAI, Anthropic, Google Gemini, NVIDIA, Groq, Kimi, and any OpenAI-compatible provider.

## Features

- **AI chat assistant** — answer questions, draft content, summarize documents, and brainstorm ideas
- **App builder** — Lovable-like builder for creating internal dashboards and tools, maintained by agents with git version control
- **MCP UI** — visual interface for managing MCP servers and building agent-maintained internal dashboards
- **MCP registry** — discover and install MCP servers from the built-in registry
- **Skills marketplace** — install community-built skills from [ClawHub](https://clawhub.ai) and [skills.sh](https://skills.sh)
- **A2A protocol** — let other AI agents discover and communicate with Coworker via Agent-to-Agent protocol
- **Scheduled tasks** — run recurring AI workflows on a cron schedule via Inngest
- **Google Workspace** — manage emails, calendar, and docs through natural language
- **WhatsApp bridge** — interact with your AI agent via WhatsApp messages
- **File workspace** — upload, manage, and reference files in agent conversations
- **API access** — secure API key authentication for programmatic access and integrations
- **Multi-provider AI** — switch between OpenAI, Anthropic, Google, NVIDIA, Groq, Kimi, or any OpenAI-compatible endpoint

## Stack

- **Backend**: Mastra agents + tools (TypeScript)
- **Desktop**: Electron app (React + Tailwind)
- **Integrations**: WhatsApp, Google Workspace (gog CLI), MCP
- **Scheduling**: Inngest
- **Runtime**: Bun

## Deploy to Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/coworker?referralCode=7FU369)

One-click deploy of the Coworker server with Inngest, Postgres, Redis, and optional Tailscale private networking. After deploying, set your `MODEL` and API key (e.g. `OPENAI_API_KEY`) in the Railway service variables. See `.env.example` for all supported providers.

Download the [desktop app](https://github.com/Array-Ventures/coworker/releases) for macOS and point it at your Railway server URL.

## Self-Host

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

The app connects to `http://localhost:4111` by default. To connect to a remote server, go to **Settings > Advanced** and update the Server URL.

### Docker

```bash
docker compose up
```

Builds are automated via GitHub Actions and pushed to `ghcr.io`.

## Auto-Updates

The desktop app supports automatic updates via GitHub Releases. When a new release is published, users are notified in **Settings > Advanced** where they can download and install the update.

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
