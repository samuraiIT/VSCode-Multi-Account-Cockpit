/**
 * Reads all account types stored by Cockpit Tools in ~/.antigravity_cockpit/.
 * Provides a unified snapshot across supported providers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCockpitToolsSharedDir } from '../shared/antigravity_paths';
import { logger } from '../shared/log_service';

// Public types

export type CockpitProviderKey =
    | 'antigravity'
    | 'codex'
    | 'cursor'
    | 'github_copilot'
    | 'windsurf'
    | 'kiro'
    | 'gemini'
    | 'codebuddy'
    | 'codebuddy_cn'
    | 'qoder'
    | 'trae'
    | 'zed';

export interface CockpitAccount {
    id: string;
    /** Primary display identifier (email or provider-specific fallback) */
    email: string;
    /** Optional human-readable name/login */
    displayName?: string;
    /** Plan/tier string — provider-specific */
    plan?: string;
    /** Whether this is the currently active account in Cockpit Tools */
    isCurrent: boolean;
    lastUsed?: number;
    createdAt?: number;
}

export interface CockpitProviderSection {
    provider: CockpitProviderKey;
    displayName: string;
    icon: string;
    accounts: CockpitAccount[];
    currentAccountId: string | null;
}

export interface AllCockpitAccountsSnapshot {
    sections: CockpitProviderSection[];
    totalAccounts: number;
    loadedAt: number;
}

interface GenericIndex {
    version?: string;
    accounts: unknown[];
    current_account_id?: string | null;
}

interface ProviderConfig {
    provider: CockpitProviderKey;
    displayName: string;
    icon: string;
    indexFiles: string[];
    emailKeys: string[];
    displayKeys: string[];
    planKeys: string[];
    hasCurrentAccountId: boolean;
}

const PROVIDER_CONFIGS: ProviderConfig[] = [
    {
        provider: 'antigravity',
        displayName: 'Antigravity AI',
        icon: '🤖',
        indexFiles: ['accounts.json'],
        emailKeys: ['email'],
        displayKeys: ['name'],
        planKeys: [],
        hasCurrentAccountId: true,
    },
    {
        provider: 'codex',
        displayName: 'OpenAI Codex',
        icon: '🧠',
        indexFiles: ['codex_accounts.json'],
        emailKeys: ['email'],
        displayKeys: ['email'],
        planKeys: ['plan_type'],
        hasCurrentAccountId: true,
    },
    {
        provider: 'cursor',
        displayName: 'Cursor',
        icon: '📝',
        indexFiles: ['cursor_accounts.json'],
        emailKeys: ['email'],
        displayKeys: ['email'],
        planKeys: ['membership_type'],
        hasCurrentAccountId: false,
    },
    {
        provider: 'github_copilot',
        displayName: 'GitHub Copilot',
        icon: '🐙',
        indexFiles: ['github_copilot_accounts.json'],
        emailKeys: ['github_email', 'email', 'github_login'],
        displayKeys: ['github_login'],
        planKeys: ['copilot_plan'],
        hasCurrentAccountId: false,
    },
    {
        provider: 'windsurf',
        displayName: 'Windsurf',
        icon: '🌊',
        indexFiles: ['windsurf_accounts.json'],
        emailKeys: ['github_email', 'email', 'github_login'],
        displayKeys: ['github_login'],
        planKeys: ['copilot_plan'],
        hasCurrentAccountId: false,
    },
    {
        provider: 'kiro',
        displayName: 'Kiro',
        icon: '⚡',
        indexFiles: ['kiro_accounts.json'],
        emailKeys: ['email'],
        displayKeys: ['email'],
        planKeys: ['plan_name'],
        hasCurrentAccountId: false,
    },
    {
        provider: 'gemini',
        displayName: 'Gemini CLI',
        icon: '💎',
        indexFiles: ['gemini_accounts.json'],
        emailKeys: ['email'],
        displayKeys: ['email'],
        planKeys: ['plan_name'],
        hasCurrentAccountId: false,
    },
    {
        provider: 'codebuddy',
        displayName: 'CodeBuddy',
        icon: '🧩',
        indexFiles: ['codebuddy_accounts.json'],
        emailKeys: ['email'],
        displayKeys: ['email'],
        planKeys: ['plan_type'],
        hasCurrentAccountId: false,
    },
    {
        provider: 'codebuddy_cn',
        displayName: 'CodeBuddy CN',
        icon: '🀄',
        indexFiles: ['codebuddy_cn_accounts.json', 'workbuddy_accounts.json'],
        emailKeys: ['email'],
        displayKeys: ['email'],
        planKeys: ['plan_type'],
        hasCurrentAccountId: false,
    },
    {
        provider: 'qoder',
        displayName: 'Qoder',
        icon: '📐',
        indexFiles: ['qoder_accounts.json'],
        emailKeys: ['email'],
        displayKeys: ['email'],
        planKeys: ['plan_type'],
        hasCurrentAccountId: false,
    },
    {
        provider: 'trae',
        displayName: 'Trae',
        icon: '🧭',
        indexFiles: ['trae_accounts.json'],
        emailKeys: ['email'],
        displayKeys: ['email'],
        planKeys: ['plan_type'],
        hasCurrentAccountId: false,
    },
    {
        provider: 'zed',
        displayName: 'Zed',
        icon: '🔷',
        indexFiles: ['zed_accounts.json'],
        emailKeys: ['email', 'github_login', 'user_id'],
        displayKeys: ['display_name', 'github_login'],
        planKeys: ['plan_raw'],
        hasCurrentAccountId: true,
    },
];

function readIndexFile(sharedDir: string, indexFiles: string[]): GenericIndex | null {
    for (const indexFile of indexFiles) {
        const filePath = path.join(sharedDir, indexFile);
        try {
            if (!fs.existsSync(filePath)) {
                continue;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content) as GenericIndex;
            if (!Array.isArray(parsed.accounts)) {
                continue;
            }
            return parsed;
        } catch {
            continue;
        }
    }
    return null;
}

function toRecord(val: unknown): Record<string, unknown> | null {
    if (!val || typeof val !== 'object') {
        return null;
    }
    return val as Record<string, unknown>;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return undefined;
}

function numOrUndef(val: unknown): number | undefined {
    if (typeof val === 'number' && Number.isFinite(val)) {
        return val;
    }
    if (typeof val === 'string' && val.trim().length > 0) {
        const parsed = Number(val);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

function mapAccountSummary(
    summary: unknown,
    config: ProviderConfig,
    currentAccountId: string | null,
): CockpitAccount | null {
    const row = toRecord(summary);
    if (!row) {
        return null;
    }

    const id = pickString(row, ['id', 'account_id', 'user_id', 'github_login']);
    if (!id) {
        return null;
    }

    const email = pickString(row, config.emailKeys) ?? id;
    const displayName = pickString(row, config.displayKeys);
    const plan = pickString(row, config.planKeys);
    const isCurrent = Boolean(
        config.hasCurrentAccountId
        && currentAccountId
        && id === currentAccountId,
    );

    return {
        id,
        email,
        displayName,
        plan,
        isCurrent,
        lastUsed: numOrUndef(row['last_used']),
        createdAt: numOrUndef(row['created_at']),
    };
}

function readProviderSection(sharedDir: string, config: ProviderConfig): CockpitProviderSection {
    const index = readIndexFile(sharedDir, config.indexFiles);
    const currentAccountId = config.hasCurrentAccountId ? (index?.current_account_id ?? null) : null;
    const accounts = (index?.accounts ?? [])
        .map((summary) => mapAccountSummary(summary, config, currentAccountId))
        .filter((account): account is CockpitAccount => Boolean(account));

    return {
        provider: config.provider,
        displayName: config.displayName,
        icon: config.icon,
        accounts,
        currentAccountId,
    };
}

/**
 * Reads all Cockpit Tools account index files and returns a unified snapshot.
 * Never throws — errors per-provider are logged and that section is skipped.
 */
export function readAllCockpitAccounts(): AllCockpitAccountsSnapshot {
    const sharedDir = getCockpitToolsSharedDir();
    const sections: CockpitProviderSection[] = [];

    for (const config of PROVIDER_CONFIGS) {
        try {
            const section = readProviderSection(sharedDir, config);
            if (section.accounts.length > 0) {
                sections.push(section);
            }
        } catch (err) {
            logger.warn(`[AllCockpitAccounts] Error reading ${config.provider}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const totalAccounts = sections.reduce((sum, section) => sum + section.accounts.length, 0);
    logger.debug(`[AllCockpitAccounts] Loaded ${totalAccounts} accounts across ${sections.length} providers`);

    return {
        sections,
        totalAccounts,
        loadedAt: Date.now(),
    };
}
