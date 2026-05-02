import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { credentialStorage } from '../auto_trigger/credential_storage';
import { oauthService } from '../auto_trigger/oauth_service';

const DATA_DIR = path.join(os.homedir(), '.antigravity_tools');
const INDEX_PATH = path.join(DATA_DIR, 'accounts.json');
const ACCOUNTS_DIR = path.join(DATA_DIR, 'accounts');

export interface AntigravityToolsDetection {
    currentEmail: string;
    newEmails: string[];
    currentEmailExistsLocally: boolean;
}

interface AntigravityToolsAccount {
    id: string;
    email: string;
    refreshToken: string;
}

export interface AntigravityToolsImportResult {
    currentEmail: string;
    switched: boolean;
    currentAvailable: boolean;
    skipped: Array<{ email: string; reason: string }>;
}

interface AntigravityToolsJsonAccount {
    email: string;
    refreshToken: string;
}

export interface AntigravityToolsJsonImportResult {
    imported: number;
    skipped: Array<{ email: string; reason: string }>;
}

/**
 *
 */
export class AntigravityToolsSyncService {
    /**
     *
     */
    async detect(): Promise<AntigravityToolsDetection | null> {
        const data = await this.readAntigravityToolsAccounts();
        if (!data || !data.currentAccount) {
            return null;
        }

        const existing = await credentialStorage.getAllCredentials();
        const existingEmails = new Set(Object.keys(existing).map(e => e.toLowerCase()));

        const newEmails: string[] = [];
        const newEmailSet = new Set<string>();
        for (const account of data.accounts) {
            const emailLower = account.email.toLowerCase();
            if (existingEmails.has(emailLower) || newEmailSet.has(emailLower)) {
                continue;
            }
            newEmailSet.add(emailLower);
            newEmails.push(account.email);
        }

        const currentEmailExistsLocally = existingEmails.has(data.currentAccount.email.toLowerCase());

        return {
            currentEmail: data.currentAccount.email,
            newEmails: Array.from(new Set(newEmails)),
            currentEmailExistsLocally,
        };
    }

    /**
     *
     *
     * @param activeEmail
     * @param importOnly
     * @param onProgress
     * @param cancelToken
     */
    async importAndSwitch(
        activeEmail?: string | null,
        importOnly: boolean = false,
        onProgress?: (current: number, total: number, email: string) => void,
        cancelToken?: { cancelled: boolean },
    ): Promise<AntigravityToolsImportResult> {
        const data = await this.readAntigravityToolsAccounts();
        if (!data || !data.currentAccount) {
            throw new Error('Antigravity Tools current account not found');
        }

        const existing = await credentialStorage.getAllCredentials();
        const existingByLower = new Map(Object.keys(existing).map(email => [email.toLowerCase(), email]));
        const currentEmailLower = data.currentAccount.email.toLowerCase();
        const skipped: Array<{ email: string; reason: string }> = [];

        const accountsToProcess = data.accounts.filter(account => {
            const accountEmailLower = account.email.toLowerCase();
            const isCurrent = accountEmailLower === currentEmailLower;


            return !(existingByLower.has(accountEmailLower) && !isCurrent);
        });

        const total = accountsToProcess.length;
        let current = 0;

        const ACCOUNT_TIMEOUT = 30000;

        for (const account of accountsToProcess) {
            if (cancelToken?.cancelled) {
                skipped.push({ email: account.email, reason: 'User cancelled' });
                continue;
            }

            current++;
            if (onProgress) {
                onProgress(current, total, account.email);
            }

            try {

                const credential = await Promise.race([
                    oauthService.buildCredentialFromRefreshToken(
                        account.refreshToken,
                        account.email,
                    ),
                    new Promise<never>((_, reject) => 
                        setTimeout(() => reject(new Error('Verification timed out, skipped')), ACCOUNT_TIMEOUT),
                    ),
                ]);

                const credentialEmail = credential.email ?? account.email;
                const credentialEmailLower = credentialEmail.toLowerCase();
                const existingKey = existingByLower.get(credentialEmailLower);
                const targetEmail = existingKey ?? credentialEmail;
                credential.email = targetEmail;

                if (existingKey) {
                    if (credentialEmailLower === currentEmailLower) {
                        await credentialStorage.saveCredential(credential);
                        await credentialStorage.clearAccountInvalid(targetEmail);
                    }
                    continue;
                }

                await credentialStorage.saveCredentialForAccount(targetEmail, credential);
                await credentialStorage.clearAccountInvalid(targetEmail);
                existingByLower.set(credentialEmailLower, targetEmail);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                skipped.push({ email: account.email, reason });
                continue;
            }
        }

        if (importOnly) {
            const currentEmail = existingByLower.get(currentEmailLower) ?? data.currentAccount.email;
            return {
                currentEmail,
                switched: false,
                currentAvailable: existingByLower.has(currentEmailLower),
                skipped,
            };
        }

        const currentAvailable = existingByLower.has(currentEmailLower);
        const currentEmail = currentAvailable
            ? (existingByLower.get(currentEmailLower) ?? data.currentAccount.email)
            : (activeEmail ?? data.currentAccount.email);
        const activeEmailLower = activeEmail?.toLowerCase();
        const shouldSwitch = currentAvailable && (!activeEmailLower || activeEmailLower !== currentEmailLower);
        if (shouldSwitch) {
            await credentialStorage.setActiveAccount(currentEmail);
        }

        return {
            currentEmail,
            switched: shouldSwitch,
            currentAvailable,
            skipped,
        };
    }

    /**
     *
     * @param jsonText JSON
     * @param onProgress
     */
    async importFromJson(
        jsonText: string,
        onProgress?: (current: number, total: number, email: string) => void,
        cancelToken?: { cancelled: boolean },
    ): Promise<AntigravityToolsJsonImportResult> {
        const parsed = this.parseJsonAccounts(jsonText);
        if (parsed.accounts.length === 0) {
            throw new Error('No valid account found');
        }

        const existing = await credentialStorage.getAllCredentials();
        const existingByLower = new Map(Object.keys(existing).map(email => [email.toLowerCase(), email]));
        const skipped: Array<{ email: string; reason: string }> = [...parsed.skipped];
        let imported = 0;

        const total = parsed.accounts.length;
        let current = 0;

        const ACCOUNT_TIMEOUT = 30000;

        for (const account of parsed.accounts) {
            if (cancelToken?.cancelled) {
                skipped.push({ email: account.email, reason: 'User cancelled' });
                continue;
            }

            current++;
            if (onProgress) {
                onProgress(current, total, account.email);
            }

            try {

                const credential = await Promise.race([
                    oauthService.buildCredentialFromRefreshToken(
                        account.refreshToken,
                        account.email,
                    ),
                    new Promise<never>((_, reject) => 
                        setTimeout(() => reject(new Error('Verification timed out, skipped')), ACCOUNT_TIMEOUT),
                    ),
                ]);

                const credentialEmail = credential.email ?? account.email;
                const credentialEmailLower = credentialEmail.toLowerCase();
                const existingKey = existingByLower.get(credentialEmailLower);
                const targetEmail = existingKey ?? credentialEmail;
                credential.email = targetEmail;

                if (existingKey) {
                    await credentialStorage.saveCredential(credential);
                } else {
                    await credentialStorage.saveCredentialForAccount(targetEmail, credential);
                }

                await credentialStorage.clearAccountInvalid(targetEmail);
                existingByLower.set(credentialEmailLower, targetEmail);
                imported += 1;
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                skipped.push({ email: account.email, reason });
            }
        }

        return { imported, skipped };
    }

    /**
     *
     *
     */
    async switchOnly(email: string): Promise<void> {
        const existing = await credentialStorage.getAllCredentials();
        const matched = Object.keys(existing).find(key => key.toLowerCase() === email.toLowerCase());
        if (!matched) {
            return;
        }
        await credentialStorage.setActiveAccount(matched);
    }

    /**
     *
     */
    private async readAntigravityToolsAccounts(): Promise<{ accounts: AntigravityToolsAccount[]; currentAccount?: AntigravityToolsAccount } | null> {
        try {
            const indexRaw = await fs.promises.readFile(INDEX_PATH, 'utf-8');
            const indexJson = JSON.parse(indexRaw) as { current_account_id?: string; accounts?: { id: string }[] };
            const currentId = indexJson.current_account_id;
            const ids = (indexJson.accounts || []).map(acc => acc.id);
            if (!currentId || ids.length === 0) {return null;}


            const accountPromises = ids.map(async id => {
                try {
                    const accountPath = path.join(ACCOUNTS_DIR, `${id}.json`);
                    const accountRaw = await fs.promises.readFile(accountPath, 'utf-8');
                    const accountJson = JSON.parse(accountRaw) as {
                        email?: string;
                        token?: { refresh_token?: string; email?: string };
                    };

                    const email = accountJson.token?.email || accountJson.email;
                    const refreshToken = accountJson.token?.refresh_token;

                    if (!email || !refreshToken) {return null;}
                    return { id, email, refreshToken };
                } catch (e) {
                    return null;
                }
            });

            const results = await Promise.all(accountPromises);
            const accounts = results.filter((acc): acc is AntigravityToolsAccount => acc !== null);

            const currentAccount = accounts.find(acc => acc.id === currentId);
            return { accounts, currentAccount };
        } catch (error) {
            return null;
        }
    }

    private parseJsonAccounts(jsonText: string): { accounts: AntigravityToolsJsonAccount[]; skipped: Array<{ email: string; reason: string }> } {
        const trimmed = jsonText?.trim();
        if (!trimmed) {
            throw new Error('JSON is empty');
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            throw new Error('JSON parse failed');
        }

        if (!Array.isArray(parsed)) {
            throw new Error('JSON must be an array');
        }

        const accounts: AntigravityToolsJsonAccount[] = [];
        const skipped: Array<{ email: string; reason: string }> = [];
        const seen = new Set<string>();

        for (const item of parsed) {
            if (!item || typeof item !== 'object') {
                skipped.push({ email: '', reason: 'Invalid entry format' });
                continue;
            }

            const rawEmail = typeof (item as { email?: unknown }).email === 'string'
                ? (item as { email: string }).email.trim()
                : '';
            const rawToken = typeof (item as { refresh_token?: unknown }).refresh_token === 'string'
                ? (item as { refresh_token: string }).refresh_token.trim()
                : (typeof (item as { refreshToken?: unknown }).refreshToken === 'string'
                    ? (item as { refreshToken: string }).refreshToken.trim()
                    : '');

            if (!rawEmail || !rawToken) {
                skipped.push({ email: rawEmail || '', reason: 'Missing email or refresh_token' });
                continue;
            }

            const emailLower = rawEmail.toLowerCase();
            if (seen.has(emailLower)) {
                skipped.push({ email: rawEmail, reason: 'Duplicate email' });
                continue;
            }
            seen.add(emailLower);
            accounts.push({ email: rawEmail, refreshToken: rawToken });
        }

        return { accounts, skipped };
    }
}
