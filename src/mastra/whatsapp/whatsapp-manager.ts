import fs from 'node:fs';
import path from 'node:path';
import type { Mastra } from '@mastra/core/mastra';
import { DisconnectReason, type ConnectionState } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import {
  createWhatsAppSocket,
  closeWhatsAppSocket,
  getStatusCode,
  type WhatsAppSocket,
  type WhatsAppConnectionStatus,
} from './whatsapp-session';
import { WhatsAppBridge } from './whatsapp-bridge';
import { normalizeWhatsAppId } from './whatsapp-utils';
import { db } from '../db';

export interface WhatsAppState {
  status: WhatsAppConnectionStatus;
  qrDataUrl: string | null;
  connectedPhone: string | null;
}

export class WhatsAppManager {
  private mastra!: Mastra;
  private socket: WhatsAppSocket | null = null;
  private bridge: WhatsAppBridge | null = null;
  private state: WhatsAppState = {
    status: 'disconnected',
    qrDataUrl: null,
    connectedPhone: null,
  };
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private stopped = false;
  private connectPromise: Promise<void> | null = null;
  private authDir = path.resolve('../../whatsapp-auth');

  // ── Lifecycle ──

  setMastra(mastra: Mastra): void {
    this.mastra = mastra;
  }

  async init(): Promise<void> {
    const enabled = await this.getConfig('enabled');
    const autoConnect = await this.getConfig('auto_connect');
    if (enabled === 'true' && autoConnect === 'true') {
      console.log('[whatsapp] auto-connecting...');
      await this.connect();
    }
  }

  // ── Connection management ──

  async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    if (this.state.status === 'connected') return;
    this.connectPromise = this._connect().finally(() => { this.connectPromise = null; });
    return this.connectPromise;
  }

  private async _connect(): Promise<void> {
    this.stopped = false;
    this.state = { status: 'connecting', qrDataUrl: null, connectedPhone: null };

    // Clean up existing bridge + socket
    if (this.bridge) {
      this.bridge.detach();
      this.bridge = null;
    }
    if (this.socket) {
      closeWhatsAppSocket(this.socket);
      this.socket = null;
    }

    this.socket = await createWhatsAppSocket({
      authDir: this.authDir,
      onQr: async (qr: string) => {
        try {
          const dataUrl = await QRCode.toDataURL(qr, { width: 256 });
          this.state = { ...this.state, status: 'qr_ready', qrDataUrl: dataUrl };
        } catch (err) {
          console.error('[whatsapp] QR generation failed:', err);
        }
      },
      onConnectionUpdate: (update: Partial<ConnectionState>) => {
        if (update.connection === 'open') {
          this.reconnectAttempts = 0;
          const me = this.socket?.user?.id;
          const phone = me ? normalizeWhatsAppId(me.split(':')[0]) : null;
          this.state = { status: 'connected', qrDataUrl: null, connectedPhone: phone };
          console.log(`[whatsapp] connected as ${phone}`);

          // Persist enabled state
          void this.setConfig('enabled', 'true');
          void this.setConfig('auto_connect', 'true');
        }

        if (update.connection === 'close') {
          this.handleDisconnect(update);
        }
      },
    });

    // Create bridge and attach message handler
    this.bridge = new WhatsAppBridge(this.mastra, this.socket);
    this.bridge.attach();
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.clearReconnectTimer();
    if (this.bridge) {
      this.bridge.detach();
      this.bridge = null;
    }
    if (this.socket) {
      closeWhatsAppSocket(this.socket);
      this.socket = null;
    }
    this.state = { status: 'disconnected', qrDataUrl: null, connectedPhone: null };
    await this.setConfig('auto_connect', 'false');
  }

  async logout(): Promise<void> {
    await this.disconnect();
    // Remove auth directory to force QR re-scan
    if (fs.existsSync(this.authDir)) {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    }
    await this.setConfig('enabled', 'false');
  }

  getState(): WhatsAppState {
    return { ...this.state };
  }

  // ── Allowlist CRUD ──

  async listAllowlist(): Promise<{ phoneNumber: string; rawJid: string | null; label: string | null; createdAt: string }[]> {
    const result = await db.execute('SELECT * FROM whatsapp_allowlist ORDER BY created_at DESC');
    return result.rows.map((r: any) => ({
      phoneNumber: r.phone_number,
      rawJid: r.raw_jid,
      label: r.label,
      createdAt: r.created_at,
    }));
  }

  async addToAllowlist(phoneNumber: string, label?: string): Promise<void> {
    const normalized = normalizeWhatsAppId(phoneNumber);
    if (!normalized) throw new Error('Invalid phone number');
    await db.execute({
      sql: `INSERT INTO whatsapp_allowlist (phone_number, label)
            VALUES (?, ?)
            ON CONFLICT(phone_number) DO UPDATE SET label = ?`,
      args: [normalized, label ?? null, label ?? null],
    });
  }

  async removeFromAllowlist(phoneNumber: string): Promise<void> {
    const normalized = normalizeWhatsAppId(phoneNumber);
    await db.execute({
      sql: 'DELETE FROM whatsapp_allowlist WHERE phone_number = ? OR raw_jid = ?',
      args: [normalized, phoneNumber],
    });
  }

  // ── Pairing ──

  async approvePairing(code: string): Promise<{ ok: boolean; error?: string }> {
    const result = await db.execute({
      sql: `SELECT * FROM whatsapp_pairing WHERE code = ?`,
      args: [code],
    });

    if (result.rows.length === 0) {
      return { ok: false, error: 'Invalid pairing code' };
    }

    const row = result.rows[0] as any;
    const expiresAt = new Date(row.expires_at).getTime();
    if (Date.now() > expiresAt) {
      await db.execute({ sql: 'DELETE FROM whatsapp_pairing WHERE code = ?', args: [code] });
      return { ok: false, error: 'Pairing code has expired' };
    }

    const rawJid = row.raw_jid as string;
    const phone = normalizeWhatsAppId(rawJid);

    // Add to allowlist with raw_jid
    await db.execute({
      sql: `INSERT INTO whatsapp_allowlist (phone_number, raw_jid)
            VALUES (?, ?)
            ON CONFLICT(phone_number) DO UPDATE SET raw_jid = ?`,
      args: [phone, rawJid, rawJid],
    });

    // Clean up pairing entry
    await db.execute({ sql: 'DELETE FROM whatsapp_pairing WHERE code = ?', args: [code] });

    console.log(`[whatsapp] pairing approved: code=${code} jid=${rawJid} phone=${phone}`);
    return { ok: true };
  }

  // ── Config helpers ──

  async getConfig(key: string): Promise<string | null> {
    const result = await db.execute({
      sql: 'SELECT value FROM whatsapp_config WHERE key = ?',
      args: [key],
    });
    return result.rows.length > 0 ? (result.rows[0].value as string) : null;
  }

  async setConfig(key: string, value: string): Promise<void> {
    await db.execute({
      sql: `INSERT INTO whatsapp_config (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
      args: [key, value, value],
    });
  }

  // ── Reconnect logic ──

  private handleDisconnect(update: Partial<ConnectionState>): void {
    const statusCode = getStatusCode(
      (update.lastDisconnect as { error?: unknown } | undefined)?.error ?? update.lastDisconnect,
    );

    if (statusCode === DisconnectReason.loggedOut) {
      this.state = { status: 'logged_out', qrDataUrl: null, connectedPhone: null };
      console.log('[whatsapp] logged out — user must re-scan');
      return;
    }

    if (this.stopped) return;

    this.state = { ...this.state, status: 'disconnected', qrDataUrl: null };
    this.scheduleReconnect(statusCode);
  }

  private scheduleReconnect(statusCode?: number): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempts++;

    if (this.reconnectAttempts > 10) {
      console.error('[whatsapp] reconnect attempts exhausted');
      return;
    }

    // Exponential backoff with ±25% jitter (matches owpenbot)
    const base = Math.min(
      1500 * Math.pow(1.6, Math.max(0, this.reconnectAttempts - 1)),
      30_000,
    );
    const jitter = base * 0.25 * (Math.random() * 2 - 1);
    const delay = statusCode === 515
      ? 1000
      : Math.max(250, Math.round(base + jitter));

    console.log(`[whatsapp] reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
