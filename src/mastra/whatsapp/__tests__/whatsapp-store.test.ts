import { describe, expect, test } from 'bun:test';
import { WhatsAppStore, type WhatsAppData } from '../whatsapp-store';

function empty(): WhatsAppData {
  return { allowlist: [], pairings: [], config: {}, groups: [] };
}

// ─── Allowlist ────────────────────────────────────────────────────────────────

describe('allowlist', () => {
  test('isAllowed returns true for matching phone', () => {
    const store = new WhatsAppStore({
      ...empty(),
      allowlist: [{ phoneNumber: '+1234567890', rawJid: null, label: null, createdAt: '2024-01-01T00:00:00Z' }],
    });
    expect(store.isAllowed('unknown@s.whatsapp.net', '+1234567890')).toBe(true);
  });

  test('isAllowed returns true for matching rawJid', () => {
    const store = new WhatsAppStore({
      ...empty(),
      allowlist: [{ phoneNumber: '+1234567890', rawJid: '1234567890@lid', label: null, createdAt: '2024-01-01T00:00:00Z' }],
    });
    expect(store.isAllowed('1234567890@lid', '+9999999999')).toBe(true);
  });

  test('isAllowed returns false for unknown', () => {
    const store = new WhatsAppStore(empty());
    expect(store.isAllowed('unknown@lid', '+9999999999')).toBe(false);
  });

  test('getAllowlistEntry returns entry by phone', () => {
    const store = new WhatsAppStore({
      ...empty(),
      allowlist: [{ phoneNumber: '+123', rawJid: 'jid@lid', label: 'Alice', createdAt: '2024-01-01T00:00:00Z' }],
    });
    const entry = store.getAllowlistEntry('+123');
    expect(entry).toBeDefined();
    expect(entry!.rawJid).toBe('jid@lid');
  });

  test('getAllowlistEntry returns undefined for missing phone', () => {
    const store = new WhatsAppStore(empty());
    expect(store.getAllowlistEntry('+999')).toBeUndefined();
  });

  test('addToAllowlist creates new entry', () => {
    const store = new WhatsAppStore(empty());
    store.addToAllowlist('+123', { rawJid: 'jid@lid', label: 'Bob' });
    const list = store.listAllowlist();
    expect(list.length).toBe(1);
    expect(list[0].phoneNumber).toBe('+123');
    expect(list[0].rawJid).toBe('jid@lid');
    expect(list[0].label).toBe('Bob');
  });

  test('addToAllowlist upserts on same phone', () => {
    const store = new WhatsAppStore({
      ...empty(),
      allowlist: [{ phoneNumber: '+123', rawJid: null, label: 'Old', createdAt: '2024-01-01T00:00:00Z' }],
    });
    store.addToAllowlist('+123', { rawJid: 'new@lid', label: 'New' });
    const list = store.listAllowlist();
    expect(list.length).toBe(1);
    expect(list[0].rawJid).toBe('new@lid');
    expect(list[0].label).toBe('New');
  });

  test('removeFromAllowlist removes by phone', () => {
    const store = new WhatsAppStore({
      ...empty(),
      allowlist: [{ phoneNumber: '+123', rawJid: null, label: null, createdAt: '2024-01-01T00:00:00Z' }],
    });
    store.removeFromAllowlist('+123');
    expect(store.listAllowlist().length).toBe(0);
  });

  test('removeFromAllowlist removes by rawJid', () => {
    const store = new WhatsAppStore({
      ...empty(),
      allowlist: [{ phoneNumber: '+123', rawJid: 'jid@lid', label: null, createdAt: '2024-01-01T00:00:00Z' }],
    });
    store.removeFromAllowlist('+999', 'jid@lid');
    expect(store.listAllowlist().length).toBe(0);
  });

  test('listAllowlist returns sorted by createdAt desc', () => {
    const store = new WhatsAppStore({
      ...empty(),
      allowlist: [
        { phoneNumber: '+1', rawJid: null, label: null, createdAt: '2024-01-01T00:00:00Z' },
        { phoneNumber: '+2', rawJid: null, label: null, createdAt: '2024-06-01T00:00:00Z' },
      ],
    });
    const list = store.listAllowlist();
    expect(list[0].phoneNumber).toBe('+2');
    expect(list[1].phoneNumber).toBe('+1');
  });
});

// ─── Pairing ──────────────────────────────────────────────────────────────────

describe('pairing', () => {
  test('findActivePairing returns active pairing', () => {
    const store = new WhatsAppStore({
      ...empty(),
      pairings: [{ code: 'ABC123', rawJid: 'jid@s', createdAt: '2024-01-01T00:00:00Z', expiresAt: new Date(Date.now() + 60_000).toISOString() }],
    });
    const p = store.findActivePairing('jid@s');
    expect(p).not.toBeNull();
    expect(p!.code).toBe('ABC123');
  });

  test('findActivePairing returns null for expired', () => {
    const store = new WhatsAppStore({
      ...empty(),
      pairings: [{ code: 'ABC123', rawJid: 'jid@s', createdAt: '2024-01-01T00:00:00Z', expiresAt: '2020-01-01T00:00:00Z' }],
    });
    expect(store.findActivePairing('jid@s')).toBeNull();
  });

  test('findActivePairing returns null for unknown JID', () => {
    const store = new WhatsAppStore(empty());
    expect(store.findActivePairing('jid@s')).toBeNull();
  });

  test('createPairing adds entry', () => {
    const store = new WhatsAppStore(empty());
    store.createPairing('XYZ', 'jid@s', new Date(Date.now() + 60_000));
    expect(store.getPairing('XYZ')).not.toBeNull();
  });

  test('cleanExpiredPairings removes stale for specific JID only', () => {
    const store = new WhatsAppStore({
      ...empty(),
      pairings: [
        { code: 'A', rawJid: 'jid1@s', createdAt: '2024-01-01T00:00:00Z', expiresAt: '2020-01-01T00:00:00Z' },
        { code: 'B', rawJid: 'jid2@s', createdAt: '2024-01-01T00:00:00Z', expiresAt: '2020-01-01T00:00:00Z' },
        { code: 'C', rawJid: 'jid1@s', createdAt: '2024-01-01T00:00:00Z', expiresAt: new Date(Date.now() + 60_000).toISOString() },
      ],
    });
    store.cleanExpiredPairings('jid1@s');
    expect(store.getPairing('A')).toBeNull(); // expired for jid1 -> removed
    expect(store.getPairing('B')).not.toBeNull(); // expired for jid2 -> kept
    expect(store.getPairing('C')).not.toBeNull(); // active for jid1 -> kept
  });

  test('getPairing returns by code', () => {
    const store = new WhatsAppStore({
      ...empty(),
      pairings: [{ code: 'TEST', rawJid: 'jid@s', createdAt: '2024-01-01T00:00:00Z', expiresAt: '2025-01-01T00:00:00Z' }],
    });
    expect(store.getPairing('TEST')?.rawJid).toBe('jid@s');
    expect(store.getPairing('NOPE')).toBeNull();
  });

  test('deletePairing removes entry', () => {
    const store = new WhatsAppStore({
      ...empty(),
      pairings: [{ code: 'DEL', rawJid: 'jid@s', createdAt: '2024-01-01T00:00:00Z', expiresAt: '2025-01-01T00:00:00Z' }],
    });
    store.deletePairing('DEL');
    expect(store.getPairing('DEL')).toBeNull();
  });
});

// ─── Groups ───────────────────────────────────────────────────────────────────

describe('groups', () => {
  test('getGroupConfig returns allowed for enabled group', () => {
    const store = new WhatsAppStore({
      ...empty(),
      groups: [{ groupJid: 'g@g.us', groupName: 'Test', mode: 'all', enabled: true, createdAt: '2024-01-01T00:00:00Z' }],
    });
    expect(store.getGroupConfig('g@g.us')).toEqual({ allowed: true, mode: 'all' });
  });

  test('getGroupConfig returns not allowed for disabled group', () => {
    const store = new WhatsAppStore({
      ...empty(),
      groups: [{ groupJid: 'g@g.us', groupName: 'Test', mode: 'all', enabled: false, createdAt: '2024-01-01T00:00:00Z' }],
    });
    expect(store.getGroupConfig('g@g.us')).toEqual({ allowed: false, mode: 'mentions' });
  });

  test('getGroupConfig returns not allowed for missing group', () => {
    const store = new WhatsAppStore(empty());
    expect(store.getGroupConfig('g@g.us')).toEqual({ allowed: false, mode: 'mentions' });
  });

  test('listGroups returns sorted by name', () => {
    const store = new WhatsAppStore({
      ...empty(),
      groups: [
        { groupJid: 'z@g.us', groupName: 'Zebra', mode: 'all', enabled: true, createdAt: '2024-01-01T00:00:00Z' },
        { groupJid: 'a@g.us', groupName: 'Alpha', mode: 'all', enabled: true, createdAt: '2024-01-01T00:00:00Z' },
      ],
    });
    const list = store.listGroups();
    expect(list[0].groupName).toBe('Alpha');
    expect(list[1].groupName).toBe('Zebra');
  });

  test('addGroup creates new entry', () => {
    const store = new WhatsAppStore(empty());
    store.addGroup('g@g.us', 'My Group', 'observe');
    const list = store.listGroups();
    expect(list.length).toBe(1);
    expect(list[0].mode).toBe('observe');
  });

  test('addGroup upserts on same JID', () => {
    const store = new WhatsAppStore({
      ...empty(),
      groups: [{ groupJid: 'g@g.us', groupName: 'Old', mode: 'all', enabled: true, createdAt: '2024-01-01T00:00:00Z' }],
    });
    store.addGroup('g@g.us', 'New', 'mentions');
    const list = store.listGroups();
    expect(list.length).toBe(1);
    expect(list[0].groupName).toBe('New');
    expect(list[0].mode).toBe('mentions');
  });

  test('updateGroup updates partial fields', () => {
    const store = new WhatsAppStore({
      ...empty(),
      groups: [{ groupJid: 'g@g.us', groupName: 'Test', mode: 'all', enabled: true, createdAt: '2024-01-01T00:00:00Z' }],
    });
    store.updateGroup('g@g.us', { enabled: false });
    expect(store.getGroupConfig('g@g.us').allowed).toBe(false);
    // Name and mode should be unchanged
    const list = store.listGroups();
    expect(list[0].groupName).toBe('Test');
    expect(list[0].mode).toBe('all');
  });

  test('removeGroup deletes entry', () => {
    const store = new WhatsAppStore({
      ...empty(),
      groups: [{ groupJid: 'g@g.us', groupName: 'Test', mode: 'all', enabled: true, createdAt: '2024-01-01T00:00:00Z' }],
    });
    store.removeGroup('g@g.us');
    expect(store.listGroups().length).toBe(0);
  });
});

// ─── Config KV ────────────────────────────────────────────────────────────────

describe('config', () => {
  test('getConfig returns value', () => {
    const store = new WhatsAppStore({ ...empty(), config: { enabled: 'true' } });
    expect(store.getConfig('enabled')).toBe('true');
  });

  test('getConfig returns null for missing key', () => {
    const store = new WhatsAppStore(empty());
    expect(store.getConfig('nope')).toBeNull();
  });

  test('setConfig creates new key', () => {
    const store = new WhatsAppStore(empty());
    store.setConfig('enabled', 'true');
    expect(store.getConfig('enabled')).toBe('true');
  });

  test('setConfig overwrites existing key', () => {
    const store = new WhatsAppStore({ ...empty(), config: { enabled: 'true' } });
    store.setConfig('enabled', 'false');
    expect(store.getConfig('enabled')).toBe('false');
  });
});
