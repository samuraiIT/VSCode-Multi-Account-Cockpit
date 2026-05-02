/**
 * Reads all account types stored by Cockpit Tools in ~/.antigravity_cockpit/.
 * Provides a unified snapshot across the providers supported by cockpit-tools.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCockpitToolsSharedDir } from '../shared/antigravity_paths';
import { logger } from '../shared/log_service';

export interface CockpitAccount {
    id: string;
    /** Primary display identity: email when available, otherwise login/user label */
    email: string;
    displayName?: string;
    plan?: string;
    isCurrent: boolean;
    lastUsed?: number;
    createdAt?: number;
}

export interface CockpitProviderSection {
    provider: string;
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
    accounts: Array<Record<string, unknown>>;
    current_account_id?: string | null;
}

interface ProviderCurrentState {
    version?: string;
    current_accounts?: Record<string, string>;
}

interface ProviderDefinition {
    provider: string;
    fileName: string;
    displayName: string;
    icon: string;
    emailFields: string[];
    displayNameFields?: string[];
    planFields?: string[];
    usesSharedCurrentState?: boolean;
}

const PROVIDER_CURRENT_STATE_FILE = 'provider_current_accounts.json';

const PROVIDERS: ProviderDefinition[] = [
    {
        provider: 'antigravity',
        fileName: 'accounts.json',
        displayName: 'Antigravity AI',
        icon: '🤖',
        emailFields: ['email'],
        displayNameFields: ['name'],
    },
    {
        provider: 'codex',
        fileName: 'codex_accounts.json',
        displayName: 'OpenAI Codex',
        icon: '🧠',
        emailFields: ['email'],
        displayNameFields: ['name'],
        planFields: ['plan_type'],
    },
    {
        provider: 'cursor',
        fileName: 'cursor_accounts.json',
        displayName: 'Cursor',
        icon: '📝',
        emailFields: ['email'],
        displayNameFields: ['name'],
        planFields: ['membership_type'],
        usesSharedCurrentState: true,
    },
    {
        provider: 'github_copilot',
        fileName: 'github_copilot_accounts.json',
        displayName: 'GitHub Copilot',
        icon: '🐙',
        emailFields: ['github_email', 'email', 'github_login'],
        displayNameFields: ['github_login'],
        planFields: ['copilot_plan'],
        usesSharedCurrentState: true,
    },
    {
        provider: 'windsurf',
        fileName: 'windsurf_accounts.json',
        displayName: 'Windsurf',
        icon: '🌊',
        emailFields: ['github_email', 'email', 'github_login'],
        displayNameFields: ['github_login'],
        planFields: ['copilot_plan', 'plan_name'],
        usesSharedCurrentState: true,
    },
    {
        provider: 'kiro',
        fileName: 'kiro_accounts.json',
        displayName: 'Kiro',
        icon: '🪁',
        emailFields: ['email', 'user_email', 'display_name'],
        displayNameFields: ['display_name', 'name'],
        planFields: ['plan_name', 'plan_tier'],
        usesSharedCurrentState: true,
    },
    {
        provider: 'gemini',
        fileName: 'gemini_accounts.json',
        displayName: 'Gemini',
        icon: '✨',
        emailFields: ['email', 'user_email'],
        displayNameFields: ['display_name', 'name'],
        planFields: ['plan_name', 'plan_tier'],
        usesSharedCurrentState: true,
    },
    {
        provider: 'codebuddy',
        fileName: 'codebuddy_accounts.json',
        displayName: 'Codebuddy',
        icon: '🧩',
        emailFields: ['email', 'uid', 'nickname'],
        displayNameFields: ['nickname', 'enterprise_name'],
        planFields: ['plan_type', 'payment_type', 'status'],
        usesSharedCurrentState: true,
    },
    {
        provider: 'codebuddy_cn',
        fileName: 'codebuddy_cn_accounts.json',
        displayName: 'Codebuddy CN',
        icon: '🈶',
        emailFields: ['email', 'uid', 'nickname'],
        displayNameFields: ['nickname', 'enterprise_name'],
        planFields: ['plan_type', 'payment_type', 'status'],
        usesSharedCurrentState: true,
    },
    {
        provider: 'workbuddy',
        fileName: 'workbuddy_accounts.json',
        displayName: 'Workbuddy',
        icon: '💼',
        emailFields: ['email', 'uid', 'nickname'],
        displayNameFields: ['nickname', 'enterprise_name'],
        planFields: ['plan_name', 'plan_type', 'status'],
        usesSharedCurrentState: true,
    },
    {
        provider: 'qoder',
        fileName: 'qoder_accounts.json',
        displayName: 'Qoder',
        icon: '🔧',
        emailFields: ['email', 'uid', 'nickname'],
        displayNameFields: ['nickname', 'display_name', 'name'],
        planFields: ['plan_name', 'plan_type', 'status'],
        usesSharedCurrentState: true,
    },
    {
        provider: 'trae',
        fileName: 'trae_accounts.json',
        displayName: 'Trae',
        icon: '🚄',
        emailFields: ['email', 'display_name', 'nickname'],
        displayNameFields: ['display_name', 'nickname', 'name'],
        planFields: ['plan_name', 'plan_type', 'status'],
        usesSharedCurrentState: true,
    },
    {
        provider: 'zed',
        fileName: 'zed_accounts.json',
        displayName: 'Zed',
        icon: '⚡',
        emailFields: ['email', 'github_login', 'display_name'],
        displayNameFields: ['display_name', 'github_login'],
        planFields: ['plan_raw', 'subscription_status'],
    },
];

function readJsonFile<T>(filePath: string): T | null {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch (err) {
        logger.warn(`[AllCockpitAccounts] Failed to parse ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}

function str(value: unknown): string {
    return value === null || value === undefined ? '' : String(value).trim();
}

function firstNonEmptyString(record: Record<string, unknown>, fields: string[]): string | undefined {
    for (const field of fields) {
        const value = str(record[field]);
        if (value) {
            return value;
        }
    }
    return undefined;
}

function firstFiniteNumber(record: Record<string, unknown>, fields: string[]): number | undefined {
    for (const field of fields) {
        const value = record[field];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}

function readProviderCurrentState(sharedDir: string): Record<string, string> {
    const state = readJsonFile<ProviderCurrentState>(path.join(sharedDir, PROVIDER_CURRENT_STATE_FILE));
    return state?.current_accounts ?? {};
}

function resolveCurrentAccountId(
    definition: ProviderDefinition,
    index: GenericIndex | null,
    sharedCurrentState: Record<string, string>,
): string | null {
    const inlineCurrentId = str(index?.current_account_id);
    if (inlineCurrentId) {
        return inlineCurrentId;
    }

    if (!definition.usesSharedCurrentState) {
        return null;
    }

    const sharedCurrentId = str(sharedCurrentState[definition.provider]);
    return sharedCurrentId || null;
}

function readProviderSection(
    sharedDir: string,
    sharedCurrentState: Record<string, string>,
    definition: ProviderDefinition,
): CockpitProviderSection {
    const index = readJsonFile<GenericIndex>(path.join(sharedDir, definition.fileName));
    const currentId = resolveCurrentAccountId(definition, index, sharedCurrentState);

    const accounts: CockpitAccount[] = (index?.accounts ?? [])
        .map((entry): CockpitAccount | null => {
            const id = firstNonEmptyString(entry, ['id']);
            if (!id) {
                return null;
            }

            const identity = firstNonEmptyString(entry, definition.emailFields)
                ?? firstNonEmptyString(entry, definition.displayNameFields ?? [])
                ?? id;
            const displayName = firstNonEmptyString(entry, definition.displayNameFields ?? []);
            const normalizedDisplayName = displayName && displayName !== identity ? displayName : undefined;

            return {
                id,
                email: identity,
                displayName: normalizedDisplayName,
                plan: firstNonEmptyString(entry, definition.planFields ?? []),
                isCurrent: currentId === id,
                lastUsed: firstFiniteNumber(entry, ['last_used', 'lastUsed', 'usage_updated_at', 'updated_at']),
                createdAt: firstFiniteNumber(entry, ['created_at', 'createdAt']),
            };
        })
        .filter((account): account is CockpitAccount => account !== null);

    return {
        provider: definition.provider,
        displayName: definition.displayName,
        icon: definition.icon,
        accounts,
        currentAccountId: currentId,
    };
}

export function readAllCockpitAccounts(): AllCockpitAccountsSnapshot {
    const sharedDir = getCockpitToolsSharedDir();
    const sharedCurrentState = readProviderCurrentState(sharedDir);
    const sections: CockpitProviderSection[] = [];

    for (const definition of PROVIDERS) {
        try {
            const section = readProviderSection(sharedDir, sharedCurrentState, definition);
            if (section.accounts.length > 0) {
                sections.push(section);
            }
        } catch (err) {
            logger.warn(`[AllCockpitAccounts] Error reading ${definition.provider}: ${err instanceof Error ? err.message : String(err)}`);
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
