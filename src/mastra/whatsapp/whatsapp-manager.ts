import fs from 'node:fs';
import path from 'node:path';
import { DATA_PATH } from '../config/paths';
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
import { WhatsAppChannel } from './whatsapp-channel';
import { normalizeWhatsAppId } from './whatsapp-utils';
import { messageRouter } from '../messaging/router';
import { whatsappStore } from './whatsapp-store';

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
  private authDir = path.join(DATA_PATH, 'whatsapp-auth');

  // -- Lifecycle --

  setMastra(mastra: Mastra): void {
    this.mastra = mastra;
  }

  async init(): Promise<void> {
    const enabled = this.getConfig('enabled');
    const autoConnect = this.getConfig('auto_connect');
    if (enabled === 'true' && autoConnect === 'true') {
      console.log('[whatsapp] auto-connecting...');
      await this.connect();
    }
  }

  // -- Connection management --

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
    messageRouter.unregister('whatsapp');
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

          // Persist bot LID for mention matching (LID survives restarts via config)
          const lid = (this.socket?.user as any)?.lid;
          if (lid) {
            this.setConfig('bot_lid', lid);
            console.log(`[whatsapp] saved bot LID: ${lid}`);
          }

          // Register with message router so `msg` CLI can send via whatsapp
          if (this.bridge) {
            messageRouter.register('whatsapp', new WhatsAppChannel(
              this.bridge,
              () => ({
                connected: this.state.status === 'connected',
                account: this.state.connectedPhone ?? undefined,
              }),
            ));
          }

          // Persist enabled state
          this.setConfig('enabled', 'true');
          this.setConfig('auto_connect', 'true');
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
    messageRouter.unregister('whatsapp');
    if (this.bridge) {
      this.bridge.detach();
      this.bridge = null;
    }
    if (this.socket) {
      closeWhatsAppSocket(this.socket);
      this.socket = null;
    }
    this.state = { status: 'disconnected', qrDataUrl: null, connectedPhone: null };
    this.setConfig('auto_connect', 'false');
  }

  async logout(): Promise<void> {
    await this.disconnect();
    // Remove auth directory to force QR re-scan
    if (fs.existsSync(this.authDir)) {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    }
    this.setConfig('enabled', 'false');
  }

  getState(): WhatsAppState {
    return { ...this.state };
  }

  // -- Allowlist CRUD --

  async listAllowlist() {
    return whatsappStore.listAllowlist();
  }

  async addToAllowlist(phoneNumber: string, label?: string): Promise<void> {
    const normalized = normalizeWhatsAppId(phoneNumber);
    if (!normalized) throw new Error('Invalid phone number');
    whatsappStore.addToAllowlist(normalized, { label: label ?? undefined });
  }

  async removeFromAllowlist(phoneNumber: string): Promise<void> {
    const normalized = normalizeWhatsAppId(phoneNumber);
    whatsappStore.removeFromAllowlist(normalized, phoneNumber);
  }

  // -- Group CRUD --

  async listGroups() {
    return whatsappStore.listGroups();
  }

  async addGroup(groupJid: string, groupName?: string, mode?: string): Promise<void> {
    whatsappStore.addGroup(groupJid, groupName, mode);
  }

  async updateGroup(groupJid: string, updates: { enabled?: boolean; mode?: string; groupName?: string }): Promise<void> {
    whatsappStore.updateGroup(groupJid, updates);
  }

  async removeGroup(groupJid: string): Promise<void> {
    whatsappStore.removeGroup(groupJid);
  }

  // -- Pairing --

  async approvePairing(code: string): Promise<{ ok: boolean; error?: string }> {
    const row = whatsappStore.getPairing(code);

    if (!row) {
      return { ok: false, error: 'Invalid pairing code' };
    }

    if (Date.now() > new Date(row.expiresAt).getTime()) {
      whatsappStore.deletePairing(code);
      return { ok: false, error: 'Pairing code has expired' };
    }

    const phone = normalizeWhatsAppId(row.rawJid);

    // Add to allowlist with raw_jid
    whatsappStore.addToAllowlist(phone, { rawJid: row.rawJid });

    // Clean up pairing entry
    whatsappStore.deletePairing(code);

    console.log(`[whatsapp] pairing approved: code=${code} jid=${row.rawJid} phone=${phone}`);
    return { ok: true };
  }

  // -- Config helpers --

  getConfig(key: string): string | null {
    return whatsappStore.getConfig(key);
  }

  setConfig(key: string, value: string): void {
    whatsappStore.setConfig(key, value);
  }

  // -- Reconnect logic --

  private handleDisconnect(update: Partial<ConnectionState>): void {
    messageRouter.unregister('whatsapp');

    const statusCode = getStatusCode(
      (update.lastDisconnect as { error?: unknown } | undefined)?.error ?? update.lastDisconnect,
    );

    if (statusCode === DisconnectReason.loggedOut) {
      console.log('[whatsapp] logged out — clearing credentials and showing fresh QR');
      // Clear stale auth so next connect generates a new QR
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
      }
      this.setConfig('auto_connect', 'false');
      // Immediately reconnect -> Baileys sees no creds -> emits QR
      this.state = { status: 'connecting', qrDataUrl: null, connectedPhone: null };
      void this.connect();
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

    // Exponential backoff with +/-25% jitter (matches owpenbot)
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
