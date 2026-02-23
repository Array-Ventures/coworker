import { readJsonConfig, writeJsonConfig } from '../config/fs-config';
import type { GroupMode } from './whatsapp-utils';

const WA_CONFIG_FILE = 'whatsapp.json';

// ─── Data types ──────────────────────────────────────────────────────────────

export interface AllowlistEntry {
  phoneNumber: string;
  rawJid: string | null;
  label: string | null;
  createdAt: string;
}

export interface PairingEntry {
  code: string;
  rawJid: string;
  createdAt: string;
  expiresAt: string;
}

export interface GroupEntry {
  groupJid: string;
  groupName: string | null;
  mode: string;
  enabled: boolean;
  createdAt: string;
}

export interface WhatsAppData {
  allowlist: AllowlistEntry[];
  pairings: PairingEntry[];
  config: Record<string, string>;
  groups: GroupEntry[];
}

const DEFAULT_DATA: WhatsAppData = { allowlist: [], pairings: [], config: {}, groups: [] };

// ─── Store ───────────────────────────────────────────────────────────────────

export class WhatsAppStore {
  private data: WhatsAppData;
  private readonly persist: boolean;

  /**
   * @param injectedData — pass data directly for tests (in-memory, no file I/O).
   *                        Omit to lazy-load from config/whatsapp.json.
   */
  constructor(injectedData?: WhatsAppData) {
    if (injectedData) {
      this.data = injectedData;
      this.persist = false;
    } else {
      this.data = readJsonConfig<WhatsAppData>(WA_CONFIG_FILE, { ...DEFAULT_DATA });
      this.persist = true;
    }
  }

  private save(): void {
    if (this.persist) writeJsonConfig(WA_CONFIG_FILE, this.data);
  }

  // ── Allowlist ────────────────────────────────────────────────────────────

  isAllowed(rawJid: string, phone: string): boolean {
    return this.data.allowlist.some(
      (e) => e.rawJid === rawJid || e.phoneNumber === phone,
    );
  }

  getAllowlistEntry(phoneNumber: string): AllowlistEntry | undefined {
    return this.data.allowlist.find((e) => e.phoneNumber === phoneNumber);
  }

  listAllowlist(): AllowlistEntry[] {
    return [...this.data.allowlist].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  addToAllowlist(phoneNumber: string, opts?: { rawJid?: string; label?: string }): void {
    const idx = this.data.allowlist.findIndex((e) => e.phoneNumber === phoneNumber);
    if (idx >= 0) {
      // Upsert: update fields that are provided
      if (opts?.rawJid !== undefined) this.data.allowlist[idx].rawJid = opts.rawJid;
      if (opts?.label !== undefined) this.data.allowlist[idx].label = opts.label;
    } else {
      this.data.allowlist.push({
        phoneNumber,
        rawJid: opts?.rawJid ?? null,
        label: opts?.label ?? null,
        createdAt: new Date().toISOString(),
      });
    }
    this.save();
  }

  removeFromAllowlist(phoneNumber: string, rawJid?: string): void {
    this.data.allowlist = this.data.allowlist.filter(
      (e) => e.phoneNumber !== phoneNumber && (rawJid ? e.rawJid !== rawJid : true),
    );
    this.save();
  }

  // ── Pairing ──────────────────────────────────────────────────────────────

  findActivePairing(rawJid: string): PairingEntry | null {
    const now = Date.now();
    return this.data.pairings.find(
      (p) => p.rawJid === rawJid && new Date(p.expiresAt).getTime() > now,
    ) ?? null;
  }

  createPairing(code: string, rawJid: string, expiresAt: Date): void {
    this.data.pairings.push({
      code,
      rawJid,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    this.save();
  }

  cleanExpiredPairings(rawJid: string): void {
    const now = Date.now();
    this.data.pairings = this.data.pairings.filter(
      (p) => !(p.rawJid === rawJid && new Date(p.expiresAt).getTime() <= now),
    );
    this.save();
  }

  getPairing(code: string): PairingEntry | null {
    return this.data.pairings.find((p) => p.code === code) ?? null;
  }

  deletePairing(code: string): void {
    this.data.pairings = this.data.pairings.filter((p) => p.code !== code);
    this.save();
  }

  // ── Groups ───────────────────────────────────────────────────────────────

  getGroupConfig(groupJid: string): { allowed: boolean; mode: GroupMode } {
    const group = this.data.groups.find((g) => g.groupJid === groupJid && g.enabled);
    if (!group) return { allowed: false, mode: 'mentions' as GroupMode };
    return { allowed: true, mode: (group.mode as GroupMode) || 'mentions' };
  }

  listGroups(): GroupEntry[] {
    return [...this.data.groups].sort((a, b) =>
      (a.groupName ?? '').localeCompare(b.groupName ?? ''),
    );
  }

  addGroup(groupJid: string, groupName?: string, mode?: string): void {
    const idx = this.data.groups.findIndex((g) => g.groupJid === groupJid);
    if (idx >= 0) {
      if (groupName !== undefined) this.data.groups[idx].groupName = groupName;
      if (mode !== undefined) this.data.groups[idx].mode = mode;
    } else {
      this.data.groups.push({
        groupJid,
        groupName: groupName ?? null,
        mode: mode ?? 'mentions',
        enabled: true,
        createdAt: new Date().toISOString(),
      });
    }
    this.save();
  }

  updateGroup(groupJid: string, updates: { enabled?: boolean; mode?: string; groupName?: string }): void {
    const group = this.data.groups.find((g) => g.groupJid === groupJid);
    if (!group) return;
    if (updates.enabled !== undefined) group.enabled = updates.enabled;
    if (updates.mode !== undefined) group.mode = updates.mode;
    if (updates.groupName !== undefined) group.groupName = updates.groupName;
    this.save();
  }

  removeGroup(groupJid: string): void {
    this.data.groups = this.data.groups.filter((g) => g.groupJid !== groupJid);
    this.save();
  }

  // ── Config KV ────────────────────────────────────────────────────────────

  getConfig(key: string): string | null {
    return this.data.config[key] ?? null;
  }

  setConfig(key: string, value: string): void {
    this.data.config[key] = value;
    this.save();
  }
}

/** Singleton instance — reads from config/whatsapp.json on first access. */
export const whatsappStore = new WhatsAppStore();
