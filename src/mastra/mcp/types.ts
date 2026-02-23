export interface McpServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'http';
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpFileConfig {
  servers: McpServerConfig[];
}
