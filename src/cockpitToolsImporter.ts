import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AccountCredentials, Platform, normalizePlatformId } from './types';
import { getCockpitToolsSharedDir } from './shared/antigravity_paths';
import {
  CockpitAccount,
  CockpitProviderKey,
  readAllCockpitAccountsFromDir,
} from './services/cockpitToolsAllAccounts';

interface AccountUpsertStore {
  getAll(): Array<{
    platform: Platform;
    email?: string;
    credentials: AccountCredentials;
  }>;
  upsert(
    platform: Platform,
    email: string,
    credentials: AccountCredentials,
    source: 'cockpit-tools',
    label?: string,
    metadata?: Record<string, unknown>
  ): { isNew: boolean };
}

interface ProviderImportConfig {
  platformId: string;
  detailDirs: string[];
}

interface ImportResult {
  added: number;
  updated: number;
  errors: string[];
  importedPlatforms: Platform[];
  totalAccounts: number;
}

const PROVIDER_IMPORT_CONFIGS: Record<CockpitProviderKey, ProviderImportConfig> = {
  antigravity: {
    platformId: 'antigravity',
    detailDirs: ['accounts'],
  },
  codex: {
    platformId: 'codex',
    detailDirs: ['codex_accounts'],
  },
  cursor: {
    platformId: 'cursor',
    detailDirs: ['cursor_accounts'],
  },
  github_copilot: {
    platformId: 'github_copilot',
    detailDirs: ['github_copilot_accounts'],
  },
  windsurf: {
    platformId: 'windsurf',
    detailDirs: ['windsurf_accounts'],
  },
  kiro: {
    platformId: 'kiro',
    detailDirs: ['kiro_accounts'],
  },
  gemini: {
    platformId: 'gemini',
    detailDirs: ['gemini_accounts'],
  },
  codebuddy: {
    platformId: 'codebuddy',
    detailDirs: ['codebuddy_accounts'],
  },
  codebuddy_cn: {
    platformId: 'codebuddy_cn',
    detailDirs: ['codebuddy_cn_accounts', 'workbuddy_accounts'],
  },
  qoder: {
    platformId: 'qoder',
    detailDirs: ['qoder_accounts'],
  },
  trae: {
    platformId: 'trae',
    detailDirs: ['trae_accounts'],
  },
  zed: {
    platformId: 'zed',
    detailDirs: ['zed_accounts'],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return undefined;
}

function findNestedString(value: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 4 || !isRecord(value)) {
    return undefined;
  }

  const direct = pickString(value, keys);
  if (direct) {
    return direct;
  }

  for (const nested of Object.values(value)) {
    const resolved = findNestedString(nested, keys, depth + 1);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function buildCredentials(detail: Record<string, unknown> | null): AccountCredentials {
  if (!detail) {
    return {};
  }

  return {
    accessToken: findNestedString(detail, ['access_token', 'accessToken']),
    refreshToken: findNestedString(detail, ['refresh_token', 'refreshToken']),
    idToken: findNestedString(detail, ['id_token', 'idToken']),
    sessionToken: findNestedString(detail, ['session_token', 'sessionToken']),
    jsonData: detail,
  };
}

function mergeCredentials(
  existing: AccountCredentials | undefined,
  incoming: AccountCredentials
): AccountCredentials {
  return {
    accessToken: incoming.accessToken ?? existing?.accessToken,
    refreshToken: incoming.refreshToken ?? existing?.refreshToken,
    idToken: incoming.idToken ?? existing?.idToken,
    sessionToken: incoming.sessionToken ?? existing?.sessionToken,
    jsonData: incoming.jsonData ?? existing?.jsonData,
  };
}

function toMetadata(
  provider: CockpitProviderKey,
  summary: CockpitAccount,
  detail: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    cockpitToolsProvider: provider,
    cockpitToolsAccountId: summary.id,
    cockpitToolsPlan: summary.plan ?? null,
    cockpitToolsDisplayName: summary.displayName ?? null,
    cockpitToolsIsCurrent: summary.isCurrent,
    cockpitToolsLastUsed: summary.lastUsed ?? null,
    cockpitToolsCreatedAt: summary.createdAt ?? null,
    cockpitToolsDetailAvailable: Boolean(detail),
  };
}

export class CockpitToolsImporter {
  constructor(private readonly accountStore: AccountUpsertStore) {}

  detectDataDir(): string | null {
    const candidates = [
      getCockpitToolsSharedDir(),
      path.join(os.homedir(), '.cockpit-tools'),
      path.join(os.homedir(), '.antigravity_cockpit'),
    ];

    for (const dir of candidates) {
      if (fs.existsSync(dir)) {
        return dir;
      }
    }

    return null;
  }

  async importAll(dataDir?: string): Promise<ImportResult> {
    const dir = dataDir ?? this.detectDataDir();
    if (!dir) {
      return {
        added: 0,
        updated: 0,
        errors: ['Cockpit Tools data directory not found.'],
        importedPlatforms: [],
        totalAccounts: 0,
      };
    }

    const snapshot = readAllCockpitAccountsFromDir(dir);
    let added = 0;
    let updated = 0;
    const errors: string[] = [];
    const importedPlatforms = new Set<Platform>();
    const seenAccounts = new Set<string>();
    const existingAccounts = new Map(
      this.accountStore
        .getAll()
        .filter((account) => typeof account.email === 'string' && account.email.trim().length > 0)
        .map((account) => [`${account.platform}:${account.email!.toLowerCase()}`, account])
    );

    for (const section of snapshot.sections) {
      const providerConfig = PROVIDER_IMPORT_CONFIGS[section.provider];
      const platform = normalizePlatformId(providerConfig?.platformId ?? section.provider);

      if (!providerConfig || !platform) {
        errors.push(`Unsupported Cockpit Tools provider: ${section.provider}`);
        continue;
      }

      for (const summary of section.accounts) {
        const detail = this.readAccountDetail(dir, section.provider, summary.id, errors);
        const resolvedEmail = this.resolveEmail(summary, detail);
        const dedupeKey = `${platform}:${resolvedEmail.toLowerCase()}`;

        if (seenAccounts.has(dedupeKey)) {
          continue;
        }

        const existingAccount = existingAccounts.get(dedupeKey);
        const email = existingAccount?.email ?? resolvedEmail;
        const label = this.resolveLabel(summary, detail, email);
        const credentials = mergeCredentials(existingAccount?.credentials, buildCredentials(detail));
        const metadata = toMetadata(section.provider, summary, detail);

        const { isNew } = this.accountStore.upsert(
          platform,
          email,
          credentials,
          'cockpit-tools',
          label,
          metadata
        );

        if (isNew) {
          added++;
        } else {
          updated++;
        }

        importedPlatforms.add(platform);
        seenAccounts.add(dedupeKey);
        existingAccounts.set(dedupeKey, {
          platform,
          email,
          credentials,
        });
      }
    }

    return {
      added,
      updated,
      errors,
      importedPlatforms: Array.from(importedPlatforms.values()),
      totalAccounts: snapshot.totalAccounts,
    };
  }

  private readAccountDetail(
    dataDir: string,
    provider: CockpitProviderKey,
    accountId: string,
    errors: string[]
  ): Record<string, unknown> | null {
    const providerConfig = PROVIDER_IMPORT_CONFIGS[provider];
    for (const detailDir of providerConfig.detailDirs) {
      const detailPath = path.join(dataDir, detailDir, `${accountId}.json`);
      if (!fs.existsSync(detailPath)) {
        continue;
      }

      try {
        const parsed = JSON.parse(fs.readFileSync(detailPath, 'utf-8')) as unknown;
        return isRecord(parsed) ? parsed : null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`[${provider}] Failed to parse ${path.basename(detailPath)}: ${message}`);
        continue;
      }
    }

    return null;
  }

  private resolveEmail(summary: CockpitAccount, detail: Record<string, unknown> | null): string {
    return (
      findNestedString(detail, ['email', 'github_email', 'user_email', 'login', 'github_login']) ??
      summary.email
    );
  }

  private resolveLabel(
    summary: CockpitAccount,
    detail: Record<string, unknown> | null,
    fallbackEmail: string
  ): string {
    return (
      summary.displayName ??
      findNestedString(detail, ['label', 'name', 'display_name', 'account_name', 'github_login']) ??
      fallbackEmail
    );
  }
}
