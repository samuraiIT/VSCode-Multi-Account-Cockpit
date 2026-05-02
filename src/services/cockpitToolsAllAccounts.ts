/**
 * Reads all account types stored by Cockpit Tools in ~/.antigravity_cockpit/.
 * Provides a unified snapshot across providers: Antigravity AI, OpenAI Codex,
 * Cursor, and GitHub Copilot.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCockpitToolsSharedDir } from '../shared/antigravity_paths';
import { logger } from '../shared/log_service';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CockpitAccount {
    id: string;
    /** Primary display email (may be github_email for Copilot) */
    email: string;
    /** Optional human-readable name (e.g. GitHub login) */
    displayName?: string;
    /** Plan/tier string — provider-specific (e.g. "plus", "free", "individual") */
    plan?: string;
    /** Whether this is the currently active account in Cockpit Tools */
    isCurrent: boolean;
    lastUsed?: number;
    createdAt?: number;
}

export interface CockpitProviderSection {
    /** Internal provider key */
    provider: 'antigravity' | 'codex' | 'cursor' | 'github_copilot';
    /** Human-readable provider name */
    displayName: string;
    /** Emoji icon */
    icon: string;
    accounts: CockpitAccount[];
    currentAccountId: string | null;
}

export interface AllCockpitAccountsSnapshot {
    sections: CockpitProviderSection[];
    /** Sum of accounts across all sections */
    totalAccounts: number;
    /** Unix ms timestamp of when this snapshot was taken */
    loadedAt: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface GenericIndex {
    version?: string;
    accounts: Array<Record<string, unknown>>;
    current_account_id?: string | null;
}

function readIndexFile(filePath: string): GenericIndex | null {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as GenericIndex;
    } catch {
        return null;
    }
}

function str(val: unknown): string {
    return val != null ? String(val) : '';
}

function numOrUndef(val: unknown): number | undefined {
    return typeof val === 'number' ? val : undefined;
}

// ---------------------------------------------------------------------------
// Per-provider readers
// ---------------------------------------------------------------------------

function readAntigravitySection(sharedDir: string): CockpitProviderSection {
    const index = readIndexFile(path.join(sharedDir, 'accounts.json'));
    const currentId = index?.current_account_id ?? null;
    const accounts: CockpitAccount[] = (index?.accounts ?? []).map(a => ({
        id: str(a['id']),
        email: str(a['email']),
        displayName: a['name'] ? str(a['name']) : undefined,
        isCurrent: str(a['id']) === currentId,
        lastUsed: numOrUndef(a['last_used']),
        createdAt: numOrUndef(a['created_at']),
    }));
    return { provider: 'antigravity', displayName: 'Antigravity AI', icon: '🤖', accounts, currentAccountId: currentId };
}

function readCodexSection(sharedDir: string): CockpitProviderSection {
    const index = readIndexFile(path.join(sharedDir, 'codex_accounts.json'));
    const currentId = index?.current_account_id ?? null;
    const accounts: CockpitAccount[] = (index?.accounts ?? []).map(a => ({
        id: str(a['id']),
        email: str(a['email']),
        plan: a['plan_type'] ? str(a['plan_type']) : undefined,
        isCurrent: str(a['id']) === currentId,
        lastUsed: numOrUndef(a['last_used']),
        createdAt: numOrUndef(a['created_at']),
    }));
    return { provider: 'codex', displayName: 'OpenAI Codex', icon: '🧠', accounts, currentAccountId: currentId };
}

function readCursorSection(sharedDir: string): CockpitProviderSection {
    const index = readIndexFile(path.join(sharedDir, 'cursor_accounts.json'));
    const currentId = index?.current_account_id ?? null;
    const accounts: CockpitAccount[] = (index?.accounts ?? []).map(a => ({
        id: str(a['id']),
        email: str(a['email']),
        plan: a['membership_type'] ? str(a['membership_type']) : undefined,
        isCurrent: str(a['id']) === currentId,
        lastUsed: numOrUndef(a['last_used']),
        createdAt: numOrUndef(a['created_at']),
    }));
    return { provider: 'cursor', displayName: 'Cursor', icon: '📝', accounts, currentAccountId: currentId };
}

function readGitHubCopilotSection(sharedDir: string): CockpitProviderSection {
    const index = readIndexFile(path.join(sharedDir, 'github_copilot_accounts.json'));
    const currentId = index?.current_account_id ?? null;
    const accounts: CockpitAccount[] = (index?.accounts ?? []).map(a => ({
        id: str(a['id']),
        email: str(a['github_email'] ?? a['email'] ?? ''),
        displayName: a['github_login'] ? str(a['github_login']) : undefined,
        plan: a['copilot_plan'] ? str(a['copilot_plan']) : undefined,
        isCurrent: str(a['id']) === currentId,
        lastUsed: numOrUndef(a['last_used']),
        createdAt: numOrUndef(a['created_at']),
    }));
    return { provider: 'github_copilot', displayName: 'GitHub Copilot', icon: '🐙', accounts, currentAccountId: currentId };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads all Cockpit Tools account files and returns a unified snapshot.
 * Never throws — errors per-provider are logged and that section is skipped.
 */
export function readAllCockpitAccounts(): AllCockpitAccountsSnapshot {
    const sharedDir = getCockpitToolsSharedDir();
    const sections: CockpitProviderSection[] = [];

    const readers: Array<() => CockpitProviderSection> = [
        () => readAntigravitySection(sharedDir),
        () => readCodexSection(sharedDir),
        () => readCursorSection(sharedDir),
        () => readGitHubCopilotSection(sharedDir),
    ];

    for (const read of readers) {
        try {
            const section = read();
            if (section.accounts.length > 0) {
                sections.push(section);
            }
        } catch (err) {
            logger.warn(`[AllCockpitAccounts] Error reading section: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const totalAccounts = sections.reduce((sum, s) => sum + s.accounts.length, 0);
    logger.debug(`[AllCockpitAccounts] Loaded ${totalAccounts} accounts across ${sections.length} providers`);

    return { sections, totalAccounts, loadedAt: Date.now() };
}
