import type { McpServerConfig } from '../mastra-client'

export interface SuperpowerSkill {
  source: string   // "vercel-labs/agent-browser" (skills.sh owner/repo)
  name: string     // "agent-browser"
}

export interface SuperpowerRuntime {
  label: string    // "agent-browser CLI + Chromium"
  install: string  // shell command to install
  check: string    // shell command to verify installation
}

export interface SuperpowerEnvVar {
  value: string
  description: string
  required: boolean
}

export interface SuperpowerDef {
  id: string
  name: string
  description: string
  icon: string  // material icon name
  components: {
    skills?: SuperpowerSkill[]
    runtimes?: SuperpowerRuntime[]
    envVars?: Record<string, SuperpowerEnvVar>
    mcpServers?: McpServerConfig[]
  }
}

export interface SuperpowerState {
  id: string
  installed: boolean
  components: {
    skills: Record<string, boolean>
    runtimes: Record<string, boolean>
    envVars: Record<string, boolean>
    mcpServers: Record<string, boolean>
  }
  installing: boolean
  installStep: string | null
  error: string | null
}

export const SUPERPOWERS: SuperpowerDef[] = [
  {
    id: 'browser-automation',
    name: 'Browser Automation',
    description: 'Browse the web, fill forms, take screenshots, and extract data from websites.',
    icon: 'language',
    components: {
      skills: [{ source: 'vercel-labs/agent-browser', name: 'agent-browser' }],
      runtimes: [{
        label: 'agent-browser CLI + Chromium',
        install: 'npm install -g agent-browser && agent-browser install --with-deps',
        check: 'agent-browser --version',
      }],
      envVars: {
        AGENT_BROWSER_STREAM_PORT: {
          value: '9223',
          description: 'WebSocket port for live browser preview',
          required: false,
        },
        PLAYWRIGHT_BROWSERS_PATH: {
          value: '~/.cache/ms-playwright',
          description: 'Path to Playwright browser binaries',
          required: false,
        },
      },
    },
  },
]
