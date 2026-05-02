/**
 * Antigravity Cockpit - Account Import Service
 *
 * Imports Codex accounts from a directory into the shared Cockpit Tools
 * data store (~/.antigravity_cockpit/codex_accounts.json + individual files).
 *
 * Supported source formats:
 *   1. Cockpit Tools full export  — JSON array of complete CodexAccount objects
 *      (e.g. codex_accounts_YYYY-MM-DD.json)
 *   2. CPA individual files       — single-object JSON with {id_token,
 *      access_token, refresh_token, account_id, email, ...}
 *      (e.g. codex_accounts_cpa_NN_email_HASH_DATE.json)
 *
 * Files named *sub2api* are intentionally skipped (different schema, not
 * compatible with the Cockpit Tools account storage format).
 *
 * After a successful import the accounts are immediately available to
 * Cockpit Tools (desktop app) and — via its WebSocket feed — to this
 * VS Code extension.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCockpitToolsSharedDir } from '../shared/antigravity_paths';
import { logger } from '../shared/log_service';

// Types matching the Cockpit Tools Rust model for Codex accounts

interface CodexTokens {
    id_token: string;
    access_token: string;
    refresh_token?: string | null;
}

/** Full account object stored in codex_accounts/<id>.json */
interface CodexAccountFull {
    id: string;
    email: string;
    auth_mode: string;
    openai_api_key?: string | null;
    api_base_url?: string | null;
    api_provider_mode: string;
    api_provider_id?: string | null;
    api_provider_name?: string | null;
    user_id?: string | null;
    plan_type?: string | null;
    subscription_active_until?: string | null;
    auth_file_plan_type?: string | null;
    account_id?: string | null;
    organization_id?: string | null;
    account_name?: string | null;
    account_structure?: string | null;
    tokens: CodexTokens;
    token_generation: number;
    token_updated_at?: number | null;
    token_source_mode: string;
    requires_reauth?: boolean;
    reauth_reason?: string | null;
    quota?: unknown;
    quota_error?: unknown;
    usage_updated_at?: number | null;
    tags?: string[] | null;
    created_at: number;
    last_used: number;
}

/** Entry stored in the codex_accounts.json index */
interface CodexAccountIndexEntry {
    id: string;
    email: string;
    plan_type?: string | null;
    subscription_active_until?: string | null;
    created_at: number;
    last_used: number;
}

/** Root of codex_accounts.json */
interface CodexAccountsIndex {
    version: string;
    accounts: CodexAccountIndexEntry[];
    current_account_id?: string | null;
}

/** CPA single-object format (files in the /123/ subdirectory) */
interface CpaFileFormat {
    id_token: string;
    access_token: string;
    refresh_token?: string;
    account_id?: string;
    last_refresh?: string;
    email: string;
    type?: string;
    expired?: string;
}

// Public result type

export interface ImportResult {
    /** Number of accounts written for the first time */
    imported: number;
    /** Number of accounts that already existed (by id or email) */
    skipped: number;
    /** Non-fatal parse errors per file */
    errors: string[];
    /** Emails of successfully imported accounts */
    emails: string[];
}

// Internal helpers

function nowSecs(): number {
    return Math.floor(Date.now() / 1000);
}

/**
 * Convert a CPA single-object file into the full CodexAccountFull shape so
 * both source formats go through the same write path.
 */
function cpaToFull(raw: CpaFileFormat): CodexAccountFull {
    const now = nowSecs();
    const tokenUpdatedAt = raw.last_refresh
        ? Math.floor(new Date(raw.last_refresh).getTime() / 1000)
        : now;

    // Build a stable id from account_id (strip dashes, pad to 32 hex chars).
    const hexId = raw.account_id
        ? raw.account_id.replace(/-/g, '').slice(0, 32).padEnd(32, '0')
        : Math.random().toString(16).slice(2, 34).padEnd(32, '0');

    return {
        id: `codex_${hexId}`,
        email: raw.email,
        auth_mode: 'oauth',
        api_provider_mode: 'openai_builtin',
        account_id: raw.account_id ?? null,
        tokens: {
            id_token: raw.id_token,
            access_token: raw.access_token,
            refresh_token: raw.refresh_token ?? null,
        },
        token_generation: 1,
        token_updated_at: tokenUpdatedAt,
        token_source_mode: 'managed',
        requires_reauth: false,
        created_at: now,
        last_used: now,
    };
}

/**
 * Recursively collect all *.json files under `dir`, skipping files whose
 * name contains "sub2api" (incompatible schema).
 */
function collectJsonFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) {
        return results;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectJsonFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.includes('sub2api')) {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * Load and validate a single JSON file into one or more CodexAccountFull
 * objects.  Returns an empty array on unrecognised format (not an error).
 */
function parseJsonFile(filePath: string): { accounts: CodexAccountFull[]; error?: string } {
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { accounts: [], error: `JSON parse error in ${path.basename(filePath)}: ${msg}` };
    }

    // Format 1 — cockpit-tools full export: array of objects with "id", "email", "tokens"
    if (Array.isArray(raw)) {
        const valid = (raw as unknown[]).filter(
            (item): item is CodexAccountFull =>
                item !== null &&
                typeof item === 'object' &&
                typeof (item as CodexAccountFull).id === 'string' &&
                typeof (item as CodexAccountFull).email === 'string' &&
                typeof (item as CodexAccountFull).tokens === 'object',
        );
        return { accounts: valid };
    }

    // Format 2 — CPA individual file: single object with "access_token" and "email"
    if (
        raw !== null &&
        typeof raw === 'object' &&
        typeof (raw as CpaFileFormat).access_token === 'string' &&
        typeof (raw as CpaFileFormat).email === 'string'
    ) {
        return { accounts: [cpaToFull(raw as CpaFileFormat)] };
    }

    // Unknown format — silently skip
    return { accounts: [] };
}

// Main export

/**
 * Import all recognised Codex account files from `importDir` into the shared
 * Cockpit Tools data directory.
 *
 * @param importDir  Directory to scan (recursively).  Defaults to
 *                   `~/.antigravity_cockpit/import` when omitted.
 */
export async function importAccountsFromDir(importDir?: string): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, skipped: 0, errors: [], emails: [] };

    const sharedDir = getCockpitToolsSharedDir();
    const resolvedImportDir = importDir ?? path.join(sharedDir, 'import');
    const indexPath = path.join(sharedDir, 'codex_accounts.json');
    const accountsDir = path.join(sharedDir, 'codex_accounts');

    logger.info(`[importService] Scanning import dir: ${resolvedImportDir}`);

    // Ensure the individual-accounts sub-directory exists
    if (!fs.existsSync(accountsDir)) {
        fs.mkdirSync(accountsDir, { recursive: true });
    }

    // Load (or initialise) the existing index
    let index: CodexAccountsIndex = { version: '1.0', accounts: [] };
    if (fs.existsSync(indexPath)) {
        try {
            index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as CodexAccountsIndex;
        } catch {
            logger.warn('[importService] codex_accounts.json unreadable — starting with empty index');
        }
    }

    const existingIds = new Set(index.accounts.map(a => a.id));
    const existingEmails = new Set(index.accounts.map(a => a.email.toLowerCase()));

    // Collect and parse all candidate files
    const candidateFiles = collectJsonFiles(resolvedImportDir);
    logger.info(`[importService] Found ${candidateFiles.length} candidate file(s)`);

    // Deduplicate by id across all files (full-format files take precedence
    // because they contain richer data; CPA files are processed afterwards)
    const byId = new Map<string, CodexAccountFull>();

    for (const filePath of candidateFiles) {
        const { accounts, error } = parseJsonFile(filePath);
        if (error) {
            result.errors.push(error);
            logger.warn(`[importService] ${error}`);
        }
        for (const acc of accounts) {
            // First-seen wins; full-format files usually appear before CPA files
            // because they are at the top level while CPA files are in /123/
            if (!byId.has(acc.id)) {
                byId.set(acc.id, acc);
            }
        }
    }

    logger.info(`[importService] Unique parsed accounts: ${byId.size}`);

    // Write new accounts
    for (const account of byId.values()) {
        const idLower = account.email.toLowerCase();

        if (existingIds.has(account.id) || existingEmails.has(idLower)) {
            result.skipped++;
            logger.debug(`[importService] Skip (duplicate): ${account.email}`);
            continue;
        }

        // Write full account file
        const accountFilePath = path.join(accountsDir, `${account.id}.json`);
        fs.writeFileSync(accountFilePath, JSON.stringify(account, null, 2), 'utf8');

        // Append to index
        index.accounts.push({
            id: account.id,
            email: account.email,
            plan_type: account.plan_type ?? null,
            subscription_active_until: account.subscription_active_until ?? null,
            created_at: account.created_at,
            last_used: account.last_used,
        });

        existingIds.add(account.id);
        existingEmails.add(idLower);
        result.imported++;
        result.emails.push(account.email);
        logger.info(`[importService] Imported: ${account.email} (${account.id})`);
    }

    // Persist updated index
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');

    logger.info(
        `[importService] Done — imported: ${result.imported}, skipped: ${result.skipped}, errors: ${result.errors.length}`,
    );

    return result;
}
