import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AccountManager } from './accountManager';
import { CockpitToolsAccount, Platform, ALL_PLATFORMS } from './types';

/**
 * Detects and imports accounts from a locally installed Cockpit Tools installation.
 *
 * Cockpit Tools stores its multi-account index under:
 *   macOS/Linux : ~/Library/Application Support/com.antigravity.cockpit-tools   (macOS)
 *                 ~/.config/com.antigravity.cockpit-tools                       (Linux)
 *   Windows     : %APPDATA%\com.antigravity.cockpit-tools
 *
 * Account files are JSON blobs inside platform-specific sub-directories.
 */
export class CockpitToolsImporter {
  constructor(private readonly accountManager: AccountManager) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Detect the default Cockpit Tools data directory for the current OS. */
  detectDataDir(): string | null {
    const candidates: string[] = [];
    const appName = 'com.antigravity.cockpit-tools';

    if (process.platform === 'darwin') {
      candidates.push(
        path.join(os.homedir(), 'Library', 'Application Support', appName),
        path.join(os.homedir(), '.config', appName)
      );
    } else if (process.platform === 'win32') {
      const appData = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming');
      candidates.push(path.join(appData, appName));
    } else {
      candidates.push(
        path.join(os.homedir(), '.config', appName),
        path.join(os.homedir(), '.local', 'share', appName)
      );
    }

    // Also check home-dir fallback used by older versions
    candidates.push(path.join(os.homedir(), '.antigravity_cockpit'));
    candidates.push(path.join(os.homedir(), '.cockpit-tools'));

    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }
    return null;
  }

  /**
   * Import all accounts from the given (or auto-detected) Cockpit Tools data directory.
   * Returns the number of accounts added / updated.
   */
  async importAll(dataDir?: string): Promise<{ added: number; updated: number; errors: string[] }> {
    const dir = dataDir ?? this.detectDataDir();
    if (!dir) {
      return { added: 0, updated: 0, errors: ['Cockpit Tools data directory not found. Install Cockpit Tools or set the path in settings.'] };
    }

    let added = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const platform of ALL_PLATFORMS) {
      try {
        const result = await this.importPlatform(dir, platform);
        added += result.added;
        updated += result.updated;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`[${platform}] ${message}`);
      }
    }

    return { added, updated, errors };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async importPlatform(
    dataDir: string,
    platform: Platform
  ): Promise<{ added: number; updated: number }> {
    const accounts = this.readPlatformAccounts(dataDir, platform);
    let added = 0;
    let updated = 0;

    for (const acc of accounts) {
      const email = acc.email ?? acc.id;
      const label = acc.label ?? email;
      const credentials = {
        accessToken: acc.accessToken,
        refreshToken: acc.refreshToken,
        jsonData: acc.sessionData,
      };

      const { isNew } = this.accountManager.upsert(
        platform,
        email,
        credentials,
        'cockpit-tools',
        label
      );
      if (isNew) added++; else updated++;
    }

    return { added, updated };
  }

  /**
   * Reads account records for a specific platform from the Cockpit Tools store.
   *
   * Cockpit Tools may store accounts in:
   *   <dataDir>/<platform>/accounts.json
   *   <dataDir>/accounts/<platform>.json
   *   <dataDir>/<platform>-accounts.json
   */
  private readPlatformAccounts(dataDir: string, platform: Platform): CockpitToolsAccount[] {
    const candidates = [
      path.join(dataDir, platform, 'accounts.json'),
      path.join(dataDir, 'accounts', `${platform}.json`),
      path.join(dataDir, `${platform}-accounts.json`),
    ];

    // Antigravity uses ~/.antigravity_cockpit/accounts.json
    if (platform === 'antigravity') {
      candidates.push(
        path.join(os.homedir(), '.antigravity_cockpit', 'accounts.json'),
        path.join(dataDir, 'antigravity_accounts.json')
      );
    }

    for (const filePath of candidates) {
      if (!fs.existsSync(filePath)) continue;
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        return this.normalise(parsed, platform);
      } catch {
        // try next candidate
      }
    }

    return [];
  }

  /**
   * Normalise arbitrary JSON shapes from Cockpit Tools into CockpitToolsAccount[].
   */
  private normalise(raw: unknown, platform: Platform): CockpitToolsAccount[] {
    if (Array.isArray(raw)) {
      return (raw as unknown[]).map((item) => this.normaliseOne(item, platform)).filter(Boolean) as CockpitToolsAccount[];
    }
    if (raw && typeof raw === 'object') {
      // Could be { accounts: [...] } or { data: [...] }
      const obj = raw as Record<string, unknown>;
      const list = obj['accounts'] ?? obj['data'] ?? obj['items'];
      if (Array.isArray(list)) {
        return (list as unknown[]).map((item) => this.normaliseOne(item, platform)).filter(Boolean) as CockpitToolsAccount[];
      }
    }
    return [];
  }

  private normaliseOne(item: unknown, platform: Platform): CockpitToolsAccount | null {
    if (!item || typeof item !== 'object') return null;
    const obj = item as Record<string, unknown>;
    return {
      id: String(obj['id'] ?? obj['accountId'] ?? obj['userId'] ?? ''),
      platform,
      email: (obj['email'] ?? obj['userEmail'] ?? obj['user_email'] ?? undefined) as string | undefined,
      label: (obj['label'] ?? obj['name'] ?? obj['alias'] ?? undefined) as string | undefined,
      accessToken: (obj['accessToken'] ?? obj['access_token'] ?? obj['token'] ?? undefined) as string | undefined,
      refreshToken: (obj['refreshToken'] ?? obj['refresh_token'] ?? undefined) as string | undefined,
      sessionData: (obj['sessionData'] ?? obj['session'] ?? obj['data'] ?? undefined) as Record<string, unknown> | undefined,
    };
  }
}
