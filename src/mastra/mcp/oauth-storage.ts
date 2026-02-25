/**
 * File-backed OAuthStorage for MCP server tokens.
 * Stores per-server OAuth data in $DATA_PATH/config/mcp-oauth.json
 */
import fs from 'fs';
import path from 'path';
import { CONFIG_PATH } from '../config/paths';
import type { OAuthStorage } from '@mastra/mcp';

const OAUTH_FILE = path.join(CONFIG_PATH, 'mcp-oauth.json');

type OAuthData = Record<string, Record<string, string>>;

function readAll(): OAuthData {
  try {
    return JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeAll(data: OAuthData): void {
  fs.mkdirSync(path.dirname(OAUTH_FILE), { recursive: true });
  fs.writeFileSync(OAUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/** Create a namespaced OAuthStorage for a specific MCP server. */
export function createFileOAuthStorage(serverId: string): OAuthStorage {
  return {
    get(key: string): string | undefined {
      return readAll()[serverId]?.[key];
    },
    set(key: string, value: string): void {
      const all = readAll();
      if (!all[serverId]) all[serverId] = {};
      all[serverId]![key] = value;
      writeAll(all);
    },
    delete(key: string): void {
      const all = readAll();
      if (all[serverId]) {
        delete all[serverId]![key];
        if (Object.keys(all[serverId]!).length === 0) delete all[serverId];
        writeAll(all);
      }
    },
  };
}

/** Check if a server has stored OAuth tokens. */
export function hasOAuthTokens(serverId: string): boolean {
  return !!readAll()[serverId]?.tokens;
}

/** Remove all OAuth data for a server. */
export function clearOAuthData(serverId: string): void {
  const all = readAll();
  delete all[serverId];
  writeAll(all);
}
