import * as https from 'https';
import * as http from 'http';
import { Account, Platform, PlatformQuota, ModelQuota } from './types';

/**
 * Fetches quota information for the active account on each platform.
 *
 * Each platform has a different API shape; we normalise everything into
 * the shared PlatformQuota type.
 */
export class QuotaService {
  /**
   * Fetch quotas for the given account.
   * Returns null if the platform is unsupported or credentials are missing.
   */
  async fetchQuota(account: Account): Promise<PlatformQuota | null> {
    try {
      switch (account.platform) {
        case 'antigravity': return await this.fetchAntigravityQuota(account);
        case 'codex':       return await this.fetchCodexQuota(account);
        case 'copilot':     return await this.fetchCopilotQuota(account);
        default:            return this.buildUnknownQuota(account);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        platform: account.platform,
        accountId: account.id,
        plan: 'unknown',
        models: [],
        fetchedAt: Date.now(),
        error: message,
      };
    }
  }

  // ── Platform-specific fetchers ───────────────────────────────────────────

  private async fetchAntigravityQuota(account: Account): Promise<PlatformQuota> {
    const token = account.credentials.accessToken ?? account.credentials.refreshToken;
    if (!token) {
      return this.buildErrorQuota(account, 'No access token');
    }

    const data = await this.get<AntigravityQuotaResponse>(
      'https://api.antigravity.ai/api/usage/quota',
      { Authorization: `Bearer ${token}` }
    );

    const models: ModelQuota[] = (data.models ?? []).map((m) => ({
      modelId: m.id,
      modelName: m.name,
      used: m.used,
      total: m.limit,
      remaining: m.limit - m.used,
      percentRemaining: m.limit > 0 ? Math.round(((m.limit - m.used) / m.limit) * 100) : 0,
      resetAt: m.resetAt ? new Date(m.resetAt).getTime() : null,
    }));

    return {
      platform: 'antigravity',
      accountId: account.id,
      plan: data.plan ?? 'unknown',
      models,
      fetchedAt: Date.now(),
    };
  }

  private async fetchCodexQuota(account: Account): Promise<PlatformQuota> {
    const token = account.credentials.accessToken;
    if (!token) {return this.buildErrorQuota(account, 'No access token');}

    const data = await this.get<CodexQuotaResponse>(
      'https://api.openai.com/codex/usage',
      { Authorization: `Bearer ${token}` }
    );

    const models: ModelQuota[] = [];
    if (data.hourly) {
      models.push({
        modelId: 'codex-hourly',
        modelName: 'Hourly',
        used: data.hourly.used,
        total: data.hourly.limit,
        remaining: data.hourly.limit - data.hourly.used,
        percentRemaining: data.hourly.limit > 0 ? Math.round(((data.hourly.limit - data.hourly.used) / data.hourly.limit) * 100) : 0,
        resetAt: data.hourly.resetAt ? new Date(data.hourly.resetAt).getTime() : null,
      });
    }
    if (data.weekly) {
      models.push({
        modelId: 'codex-weekly',
        modelName: 'Weekly',
        used: data.weekly.used,
        total: data.weekly.limit,
        remaining: data.weekly.limit - data.weekly.used,
        percentRemaining: data.weekly.limit > 0 ? Math.round(((data.weekly.limit - data.weekly.used) / data.weekly.limit) * 100) : 0,
        resetAt: data.weekly.resetAt ? new Date(data.weekly.resetAt).getTime() : null,
      });
    }

    return {
      platform: 'codex',
      accountId: account.id,
      plan: data.plan ?? 'unknown',
      models,
      fetchedAt: Date.now(),
    };
  }

  private async fetchCopilotQuota(account: Account): Promise<PlatformQuota> {
    const token = account.credentials.accessToken ?? account.credentials.refreshToken;
    if (!token) {return this.buildErrorQuota(account, 'No access token');}

    const data = await this.get<CopilotQuotaResponse>(
      'https://api.github.com/copilot_internal/user',
      {
        Authorization: `token ${token}`,
        'User-Agent': 'VSCode-Multi-Account-Cockpit',
        'X-Github-Next-Global-ID': '1',
      }
    );

    const models: ModelQuota[] = [];
    if (data.copilot_ide_chat) {
      models.push({
        modelId: 'copilot-chat',
        modelName: 'Chat messages',
        used: data.copilot_ide_chat.used ?? 0,
        total: data.copilot_ide_chat.limit ?? 0,
        remaining: (data.copilot_ide_chat.limit ?? 0) - (data.copilot_ide_chat.used ?? 0),
        percentRemaining: data.copilot_ide_chat.limit
          ? Math.round(((data.copilot_ide_chat.limit - (data.copilot_ide_chat.used ?? 0)) / data.copilot_ide_chat.limit) * 100)
          : 100,
        resetAt: null,
      });
    }
    if (data.copilot_ide_code_completions) {
      models.push({
        modelId: 'copilot-completions',
        modelName: 'Inline Suggestions',
        used: data.copilot_ide_code_completions.used ?? 0,
        total: data.copilot_ide_code_completions.limit ?? 0,
        remaining: (data.copilot_ide_code_completions.limit ?? 0) - (data.copilot_ide_code_completions.used ?? 0),
        percentRemaining: data.copilot_ide_code_completions.limit
          ? Math.round(((data.copilot_ide_code_completions.limit - (data.copilot_ide_code_completions.used ?? 0)) / data.copilot_ide_code_completions.limit) * 100)
          : 100,
        resetAt: null,
      });
    }

    return {
      platform: 'copilot',
      accountId: account.id,
      plan: data.plan?.name ?? 'unknown',
      models,
      fetchedAt: Date.now(),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildUnknownQuota(account: Account): PlatformQuota {
    return {
      platform: account.platform,
      accountId: account.id,
      plan: 'N/A',
      models: [],
      fetchedAt: Date.now(),
    };
  }

  private buildErrorQuota(account: Account, error: string): PlatformQuota {
    return {
      platform: account.platform,
      accountId: account.id,
      plan: 'unknown',
      models: [],
      fetchedAt: Date.now(),
      error,
    };
  }

  private get<T>(url: string, headers: Record<string, string>): Promise<T> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'Content-Type': 'application/json', ...headers },
      };
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(options, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`HTTP ${statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error(`Non-JSON response (${statusCode}): ${body.slice(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(10_000, () => { req.destroy(new Error('Request timeout')); });
      req.end();
    });
  }
}

// ── Platform response shapes (partial) ──────────────────────────────────────

interface AntigravityModel {
  id: string;
  name: string;
  used: number;
  limit: number;
  resetAt?: string;
}
interface AntigravityQuotaResponse {
  plan?: string;
  models?: AntigravityModel[];
}

interface CodexPeriod {
  used: number;
  limit: number;
  resetAt?: string;
}
interface CodexQuotaResponse {
  plan?: string;
  hourly?: CodexPeriod;
  weekly?: CodexPeriod;
}

interface CopilotQuotaBucket {
  used?: number;
  limit?: number;
}
interface CopilotQuotaResponse {
  plan?: { name?: string };
  copilot_ide_chat?: CopilotQuotaBucket;
  copilot_ide_code_completions?: CopilotQuotaBucket;
}
