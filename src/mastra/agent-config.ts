import { db } from './db';

export const DEFAULT_MODEL = process.env.MODEL || 'nvidia/moonshotai/kimi-k2.5';

export const DEFAULT_INSTRUCTIONS = `You are Coworker, an AI team member.

# Working Memory

You have working memory that persists across all conversations. It contains your identity (persona) and knowledge about the organization you work with. Use the updateWorkingMemory tool to evolve it over time — your personality, interests, learned behaviors, and organization details.

Update working memory when you learn something worth remembering. You don't need to update it every message — only when there's genuinely new information.`;

export class AgentConfigManager {
  async get(key: string): Promise<string | null> {
    const result = await db.execute({
      sql: 'SELECT value FROM agent_config WHERE key = ?',
      args: [key],
    });
    if (result.rows.length === 0) return null;
    return result.rows[0].value as string;
  }

  async set(key: string, value: string): Promise<void> {
    await db.execute({
      sql: `INSERT INTO agent_config (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
      args: [key, value, value],
    });
  }

  async delete(key: string): Promise<void> {
    await db.execute({
      sql: 'DELETE FROM agent_config WHERE key = ?',
      args: [key],
    });
  }

  async getModel(): Promise<string> {
    return (await this.get('model')) ?? DEFAULT_MODEL;
  }

  async getInstructions(): Promise<string> {
    return (await this.get('instructions')) ?? DEFAULT_INSTRUCTIONS;
  }

  async getConfig() {
    const model = await this.get('model');
    const instructions = await this.get('instructions');
    return {
      model: model ?? DEFAULT_MODEL,
      instructions: instructions ?? DEFAULT_INSTRUCTIONS,
      defaultModel: DEFAULT_MODEL,
      defaultInstructions: DEFAULT_INSTRUCTIONS,
      isCustomModel: model !== null,
      isCustomInstructions: instructions !== null,
    };
  }
}

export const agentConfig = new AgentConfigManager();
