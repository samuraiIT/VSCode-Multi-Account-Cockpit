import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { uuidv4 } from './utils';
import {
  Account,
  AccountStore,
  BackupManifest,
  Platform,
  AccountCredentials,
  AccountSource,
} from './types';

const STORE_VERSION = 1;
const STORE_FILE = 'accounts.json';
const BACKUPS_DIR = 'backups';

/**
 * Persists and retrieves all accounts.
 * Data is stored in VS Code's global storage directory.
 */
export class AccountManager {
  private readonly storePath: string;
  private readonly backupsPath: string;
  private store: AccountStore;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const dir = context.globalStorageUri.fsPath;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.storePath = path.join(dir, STORE_FILE);
    this.backupsPath = path.join(dir, BACKUPS_DIR);
    if (!fs.existsSync(this.backupsPath)) {
      fs.mkdirSync(this.backupsPath, { recursive: true });
    }
    this.store = this.load();
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  getAll(): Account[] {
    return [...this.store.accounts];
  }

  getByPlatform(platform: Platform): Account[] {
    return this.store.accounts.filter((a) => a.platform === platform);
  }

  getById(id: string): Account | undefined {
    return this.store.accounts.find((a) => a.id === id);
  }

  getActive(platform: Platform): Account | undefined {
    return this.store.accounts.find((a) => a.platform === platform && a.active);
  }

  add(
    platform: Platform,
    label: string,
    credentials: AccountCredentials,
    source: AccountSource = 'manual',
    email?: string,
    tags: string[] = [],
    metadata?: Record<string, unknown>
  ): Account {
    const account: Account = {
      id: uuidv4(),
      platform,
      label,
      email,
      source,
      credentials,
      active: false,
      tags,
      importedAt: Date.now(),
      metadata,
    };
    this.store.accounts.push(account);
    this.persist();
    this._onDidChange.fire();
    return account;
  }

  update(id: string, partial: Partial<Omit<Account, 'id'>>): boolean {
    const idx = this.store.accounts.findIndex((a) => a.id === id);
    if (idx === -1) {return false;}
    this.store.accounts[idx] = { ...this.store.accounts[idx], ...partial };
    this.persist();
    this._onDidChange.fire();
    return true;
  }

  remove(id: string): boolean {
    const before = this.store.accounts.length;
    this.store.accounts = this.store.accounts.filter((a) => a.id !== id);
    if (this.store.accounts.length === before) {return false;}
    this.persist();
    this._onDidChange.fire();
    return true;
  }

  setActive(id: string): boolean {
    const account = this.store.accounts.find((a) => a.id === id);
    if (!account) {return false;}
    // Deactivate all accounts on the same platform
    this.store.accounts.forEach((a) => {
      if (a.platform === account.platform) {a.active = false;}
    });
    account.active = true;
    this.persist();
    this._onDidChange.fire();
    return true;
  }

  /** Upsert an account by platform + email (used by importers). */
  upsert(
    platform: Platform,
    email: string,
    credentials: AccountCredentials,
    source: AccountSource,
    label?: string,
    metadata?: Record<string, unknown>
  ): { account: Account; isNew: boolean } {
    const existing = this.store.accounts.find(
      (a) => a.platform === platform && a.email?.toLowerCase() === email.toLowerCase()
    );
    if (existing) {
      this.update(existing.id, { credentials, source, lastSyncedAt: Date.now(), metadata });
      return { account: this.getById(existing.id)!, isNew: false };
    }
    const account = this.add(platform, label ?? email, credentials, source, email, [], metadata);
    return { account, isNew: true };
  }

  // ── Export / Import JSON ────────────────────────────────────────────────────

  exportJson(): string {
    return JSON.stringify(this.store, null, 2);
  }

  importJson(json: string): { added: number; updated: number } {
    let incoming: AccountStore;
    try {
      incoming = JSON.parse(json) as AccountStore;
    } catch {
      throw new Error('Invalid JSON format');
    }
    if (!Array.isArray(incoming.accounts)) {
      throw new Error('JSON does not contain an accounts array');
    }
    let added = 0;
    let updated = 0;
    for (const acc of incoming.accounts) {
      if (!acc.id || !acc.platform) {continue;}
      const { isNew } = this.upsert(
        acc.platform as Platform,
        acc.email ?? acc.id,
        acc.credentials ?? {},
        acc.source ?? 'json-import',
        acc.label,
        acc.metadata
      );
      if (isNew) {added++;} else {updated++;}
    }
    this._onDidChange.fire();
    return { added, updated };
  }

  // ── Backup / Restore ────────────────────────────────────────────────────────

  backup(): BackupManifest {
    const backupId = `backup-${Date.now()}`;
    const manifest: BackupManifest = {
      backupId,
      createdAt: Date.now(),
      version: STORE_VERSION,
      accountCount: this.store.accounts.length,
      platforms: [...new Set(this.store.accounts.map((a) => a.platform))],
    };
    const backupPath = path.join(this.backupsPath, `${backupId}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ manifest, store: this.store }, null, 2), 'utf-8');
    return manifest;
  }

  listBackups(): BackupManifest[] {
    if (!fs.existsSync(this.backupsPath)) {return [];}
    return fs
      .readdirSync(this.backupsPath)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(this.backupsPath, f), 'utf-8');
          const parsed = JSON.parse(raw) as { manifest: BackupManifest };
          return parsed.manifest;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as BackupManifest[];
  }

  restore(backupId: string): number {
    const backupPath = path.join(this.backupsPath, `${backupId}.json`);
    if (!fs.existsSync(backupPath)) {throw new Error(`Backup not found: ${backupId}`);}
    const raw = fs.readFileSync(backupPath, 'utf-8');
    const parsed = JSON.parse(raw) as { store: AccountStore };
    this.store = parsed.store;
    this.persist();
    this._onDidChange.fire();
    return this.store.accounts.length;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private load(): AccountStore {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        return JSON.parse(raw) as AccountStore;
      }
    } catch {
      // ignore — start fresh
    }
    return { version: STORE_VERSION, accounts: [], savedAt: Date.now() };
  }

  private persist(): void {
    this.store.savedAt = Date.now();
    fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), 'utf-8');
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
