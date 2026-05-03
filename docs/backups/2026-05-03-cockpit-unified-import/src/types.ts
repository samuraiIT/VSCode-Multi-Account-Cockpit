/**
 * Core types shared across the Multi-Account Cockpit extension.
 */

// ── Platform identifiers ────────────────────────────────────────────────────

export type Platform =
  | 'antigravity'
  | 'codex'
  | 'copilot'
  | 'windsurf'
  | 'kiro'
  | 'cursor'
  | 'gemini-cli'
  | 'codebuddy'
  | 'codebuddy-cn'
  | 'qoder'
  | 'trae'
  | 'zed';

export const ALL_PLATFORMS: Platform[] = [
  'antigravity',
  'codex',
  'copilot',
  'windsurf',
  'kiro',
  'cursor',
  'gemini-cli',
  'codebuddy',
  'codebuddy-cn',
  'qoder',
  'trae',
  'zed',
];

export const PLATFORM_LABELS: Record<Platform, string> = {
  antigravity: 'Antigravity',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
  windsurf: 'Windsurf',
  kiro: 'Kiro',
  cursor: 'Cursor',
  'gemini-cli': 'Gemini CLI',
  codebuddy: 'CodeBuddy',
  'codebuddy-cn': 'CodeBuddy CN',
  qoder: 'Qoder',
  trae: 'Trae',
  zed: 'Zed',
};

// ── Quota types ─────────────────────────────────────────────────────────────

export type QuotaStatus = 'ok' | 'warning' | 'critical' | 'exhausted' | 'unknown';

export interface ModelQuota {
  modelId: string;
  modelName: string;
  used: number;
  total: number;
  remaining: number;
  percentRemaining: number;
  resetAt: number | null; // Unix timestamp ms
  groupId?: string;
  groupName?: string;
}

export interface PlatformQuota {
  platform: Platform;
  accountId: string;
  plan: string;
  models: ModelQuota[];
  fetchedAt: number; // Unix timestamp ms
  error?: string;
}

// ── Account types ────────────────────────────────────────────────────────────

export type AccountSource = 'manual' | 'oauth' | 'token' | 'cockpit-tools' | 'json-import' | 'local';

export interface AccountCredentials {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  sessionToken?: string;
  jsonData?: Record<string, unknown>;
}

export interface Account {
  id: string;
  platform: Platform;
  label: string;
  email?: string;
  source: AccountSource;
  credentials: AccountCredentials;
  active: boolean;
  tags: string[];
  importedAt: number; // Unix timestamp ms
  lastSyncedAt?: number;
  quota?: PlatformQuota;
  metadata?: Record<string, unknown>;
}

// ── Storage types ────────────────────────────────────────────────────────────

export interface AccountStore {
  version: number;
  accounts: Account[];
  savedAt: number;
}

export interface BackupManifest {
  backupId: string;
  createdAt: number;
  version: number;
  accountCount: number;
  platforms: Platform[];
}

// ── Cockpit Tools import types ───────────────────────────────────────────────

export interface CockpitToolsAccount {
  id: string;
  platform: Platform;
  email?: string;
  label?: string;
  accessToken?: string;
  refreshToken?: string;
  sessionData?: Record<string, unknown>;
}

// ── UI / message types ────────────────────────────────────────────────────────

export interface WebviewMessage {
  command: string;
  payload?: unknown;
}

export interface DashboardState {
  accounts: Account[];
  activePlatform: Platform | 'all';
  isLoading: boolean;
  lastRefreshed: number | null;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface ExtensionSettings {
  autoRefreshInterval: number;
  cockpitToolsDataDir: string;
  statusBarFormat: 'icon' | 'dot' | 'percent' | 'dot_percent' | 'name_percent' | 'full';
  warningThreshold: number;
  criticalThreshold: number;
  notificationsEnabled: boolean;
  language: string;
}
