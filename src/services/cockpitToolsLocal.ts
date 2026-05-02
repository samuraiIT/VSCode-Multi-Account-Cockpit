/**
 * Cockpit Tools
 *
 *
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../shared/log_service';
import { getCockpitToolsSharedDir } from '../shared/antigravity_paths';

const ACCOUNTS_INDEX = 'accounts.json';

interface AccountEntry {
    id: string;
    email: string;
    name: string | null;
    created_at: number;
    last_used: number;
}

interface AccountsIndex {
    version: string;
    accounts: AccountEntry[];
    current_account_id: string | null;
}

class CockpitToolsLocal {
    /**
     *
     */
    private readAccountsIndex(): AccountsIndex | null {
        const filePath = path.join(getCockpitToolsSharedDir(), ACCOUNTS_INDEX);
        try {
            if (!fs.existsSync(filePath)) {
                logger.warn('[CockpitToolsLocal] accounts.json Does not exist');
                return null;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content) as AccountsIndex;
        } catch (err) {
            logger.error(`[CockpitToolsLocal] Failed to read accounts.json: ${err}`);
            return null;
        }
    }

    /**
     *
     */
    getAccountIdByEmail(email: string): string | null {
        const index = this.readAccountsIndex();
        if (!index) { return null; }

        const account = index.accounts.find(
            a => a.email.toLowerCase() === email.toLowerCase(),
        );
        return account?.id ?? null;
    }

    /**
     *
     */
    getAccountsList(): AccountEntry[] {
        const index = this.readAccountsIndex();
        return index?.accounts ?? [];
    }

    /**
     *
     */
    getCurrentAccountId(): string | null {
        const index = this.readAccountsIndex();
        return index?.current_account_id ?? null;
    }

    /**
     *
     */
    getCurrentAccountEmail(): string | null {
        const index = this.readAccountsIndex();
        if (!index?.current_account_id) { return null; }
        const account = index.accounts.find(a => a.id === index.current_account_id);
        return account?.email ?? null;
    }
}

export const cockpitToolsLocal = new CockpitToolsLocal();
