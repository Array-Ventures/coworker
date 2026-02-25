/**
 * MCP OAuth flow orchestrator.
 * Manages pending OAuth flows and provides authProviders for MCPClient connections.
 */
import { MCPOAuthClientProvider, auth } from '@mastra/mcp';
import { createFileOAuthStorage, hasOAuthTokens } from './oauth-storage';

const CLIENT_NAME = 'Coworker AI';

interface PendingOAuth {
  provider: MCPOAuthClientProvider;
  serverUrl: string;
  authUrl: string;
  createdAt: number;
}

/** In-memory map of pending OAuth flows, keyed by serverId. */
const pendingFlows = new Map<string, PendingOAuth>();

// Auto-cleanup old pending flows after 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, flow] of pendingFlows) {
    if (now - flow.createdAt > 10 * 60_000) pendingFlows.delete(id);
  }
}, 60_000);

function getRedirectUrl(callbackBaseUrl?: string): string {
  const base =
    callbackBaseUrl || `http://localhost:${process.env.PORT || 4111}`;
  return `${base.replace(/\/$/, '')}/mcp-oauth/callback`;
}

function createProvider(
  serverId: string,
  callbackBaseUrl?: string,
): MCPOAuthClientProvider {
  const redirectUrl = getRedirectUrl(callbackBaseUrl);
  return new MCPOAuthClientProvider({
    redirectUrl,
    clientMetadata: {
      redirect_uris: [redirectUrl],
      client_name: CLIENT_NAME,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    storage: createFileOAuthStorage(serverId),
  });
}

/**
 * Start OAuth for an MCP server.
 * Creates provider, triggers auth discovery + redirect, returns the auth URL.
 */
export async function startMcpOAuth(
  serverId: string,
  serverUrl: string,
  callbackBaseUrl?: string,
): Promise<{ authUrl: string }> {
  const provider = createProvider(serverId, callbackBaseUrl);

  // If we already have valid tokens, no auth needed
  const existingTokens = await provider.tokens();
  if (existingTokens?.access_token) {
    return { authUrl: '' };
  }

  // Override redirectToAuthorization to capture the URL
  let capturedAuthUrl: string | null = null;
  const originalRedirect = provider.redirectToAuthorization.bind(provider);
  provider.redirectToAuthorization = async (url: URL) => {
    capturedAuthUrl = url.toString();
  };

  try {
    const result = await auth(provider, { serverUrl });
    if (result === 'AUTHORIZED') {
      return { authUrl: '' };
    }
  } catch {
    // Expected — auth() may throw when redirect is needed
  }

  // Restore original
  provider.redirectToAuthorization = originalRedirect;

  if (!capturedAuthUrl) {
    throw new Error(
      'Failed to get authorization URL from MCP server. The server may not support OAuth.',
    );
  }

  pendingFlows.set(serverId, {
    provider,
    serverUrl,
    authUrl: capturedAuthUrl,
    createdAt: Date.now(),
  });

  return { authUrl: capturedAuthUrl };
}

/**
 * Handle the OAuth callback after user authorizes in browser.
 * Exchanges authorization code for tokens.
 */
export async function handleMcpOAuthCallback(
  code: string,
  _state: string,
): Promise<{ serverId: string | null; error?: string }> {
  // Try each pending flow — state matching happens inside auth()
  for (const [serverId, flow] of pendingFlows) {
    try {
      const result = await auth(flow.provider, {
        serverUrl: flow.serverUrl,
        authorizationCode: code,
      });
      if (result === 'AUTHORIZED') {
        pendingFlows.delete(serverId);
        return { serverId };
      }
    } catch (err) {
      console.error(`[mcp-oauth] Token exchange failed for ${serverId}:`, err);
      continue;
    }
  }
  return { serverId: null, error: 'No matching pending OAuth flow found' };
}

/**
 * Poll whether OAuth is complete for a server.
 */
export function pollMcpOAuth(serverId: string): {
  ok: boolean;
  pending: boolean;
} {
  if (hasOAuthTokens(serverId)) {
    pendingFlows.delete(serverId);
    return { ok: true, pending: false };
  }
  return { ok: false, pending: pendingFlows.has(serverId) };
}

/**
 * Get an MCPOAuthClientProvider for use in MCPClient connections.
 * Returns undefined if the server has no OAuth tokens.
 */
export function getOAuthProvider(
  serverId: string,
): MCPOAuthClientProvider | undefined {
  if (!hasOAuthTokens(serverId)) return undefined;
  return createProvider(serverId);
}
