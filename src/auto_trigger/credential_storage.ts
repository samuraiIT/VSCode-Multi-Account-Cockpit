/**
 * Antigravity Cockpit - Credential Storage
 * OAuth
 *
 * 
 * Supports multiple accounts with active account selection
 */

import * as vscode from 'vscode';
import { OAuthCredential, AuthorizationStatus, AccountInfo } from './types';
import { logger } from '../shared/log_service';

// Legacy single-account key (for migration)
const LEGACY_CREDENTIAL_KEY = 'antigravity.autoTrigger.credential';

// Multi-account storage keys
const CREDENTIALS_KEY = 'antigravity.autoTrigger.credentials';
const ACTIVE_ACCOUNT_KEY = 'antigravity.autoTrigger.activeAccount';
const STATE_KEY = 'antigravity.autoTrigger.state';

const TOOLS_ACCOUNT_SNAPSHOT_KEY = 'antigravity.autoTrigger.toolsAccountSnapshot';

/**
 * Multi-account credentials storage format
 */
interface CredentialsStorage {
    accounts: Record<string, OAuthCredential>;
}

/**
 *
 *
 * Supports multiple accounts
 */
class CredentialStorage {
    private secretStorage?: vscode.SecretStorage;
    private globalState?: vscode.Memento;
    private initialized = false;
    private migrationTask?: Promise<void>;

    /**
     *
     * @param context VS Code
     */
    initialize(context: vscode.ExtensionContext): void {
        this.secretStorage = context.secrets;
        this.globalState = context.globalState;
        this.initialized = true;
        logger.info('[CredentialStorage] Initialized');

        // Trigger migration check (async), keep a handle for callers to await.
        this.migrationTask = this.migrateFromLegacy().catch(err => {
            logger.error(`[CredentialStorage] Migration failed: ${err.message}`);
        });
    }

    /**
     *
     */
    private ensureInitialized(): void {
        if (!this.initialized || !this.secretStorage || !this.globalState) {
            throw new Error('CredentialStorage not initialized. Call initialize() first.');
        }
    }

    /**
     * Ensure legacy credentials migration completes before reading auth state.
     */
    private async ensureMigrated(): Promise<void> {
        if (this.migrationTask) {
            await this.migrationTask;
        }
    }

    // ============ Multi-Account Methods ============

    /**
     * Get all credentials storage
     */
    private async getCredentialsStorage(): Promise<CredentialsStorage> {
        this.ensureInitialized();
        try {
            const json = await this.secretStorage!.get(CREDENTIALS_KEY);
            if (!json) {
                return { accounts: {} };
            }
            return JSON.parse(json) as CredentialsStorage;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[CredentialStorage] Failed to get credentials storage: ${err.message}`);
            return { accounts: {} };
        }
    }

    /**
     * Save all credentials storage
     */
    private async saveCredentialsStorage(
        storage: CredentialsStorage,
        options?: { skipNotifyTools?: boolean },
    ): Promise<void> {
        this.ensureInitialized();
        try {
            const json = JSON.stringify(storage);
            await this.secretStorage!.store(CREDENTIALS_KEY, json);
            logger.info('[CredentialStorage] Credentials storage saved');


            if (!options?.skipNotifyTools) {
                this.notifyDataChanged();
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[CredentialStorage] Failed to save credentials storage: ${err.message}`);
            throw err;
        }
    }
    
    /**
     *
     */
    private notifyDataChanged(): void {
        try {
            import('../services/cockpitToolsWs').then(({ cockpitToolsWs }) => {
                if (cockpitToolsWs.isConnected) {
                    cockpitToolsWs.notifyDataChanged('extension_credential_updated');
                }
            }).catch(() => {
                // Best-effort sync only.
            });
        } catch {
            // Cockpit Tools bridge is optional.
        }
    }
    
    /**
     *
     */
    private syncAccountToCockpitTools(email: string, credential: OAuthCredential): void {
        try {
            import('../services/cockpitToolsWs').then(({ cockpitToolsWs }) => {
                if (cockpitToolsWs.isConnected) {
                    const expiresAtMs = credential.expiresAt ? Date.parse(credential.expiresAt) : NaN;
                    const expiresAt = Number.isNaN(expiresAtMs) ? undefined : Math.floor(expiresAtMs / 1000);
                    cockpitToolsWs.addAccount(
                        email,
                        credential.refreshToken,
                        credential.accessToken,
                        expiresAt,
                    ).then(result => {
                        if (result.success) {
                            logger.info(`[CredentialStorage] Account synced to Cockpit Tools: ${email}`);
                        } else {
                            logger.warn(`[CredentialStorage] Sync account to Cockpit Tools failed: ${result.message}`);
                        }
                    }).catch(() => {
                        // Best-effort sync only.
                    });
                }
            }).catch(() => {
                // Best-effort sync only.
            });
        } catch {
            // Cockpit Tools bridge is optional.
        }
    }
    
    /**
     *
     */
    private deleteAccountFromCockpitTools(email: string): void {
        try {
            import('../services/cockpitToolsWs').then(({ cockpitToolsWs }) => {
                if (cockpitToolsWs.isConnected) {
                    cockpitToolsWs.deleteAccountByEmail(email).then(result => {
                        if (result.success) {
                            logger.info(`[CredentialStorage] Notified Cockpit Tools to delete account: ${email}`);
                        } else {
                            logger.warn(`[CredentialStorage] Notify Cockpit Tools delete account failed: ${result.message}`);
                        }
                    }).catch(() => {
                        // Best-effort sync only.
                    });
                }
            }).catch(() => {
                // Best-effort sync only.
            });
        } catch {
            // Cockpit Tools bridge is optional.
        }
    }
    
    /**
     *
     */
    /*
    private syncSwitchToCockpitTools(email: string): void {
        try {
            import('../services/cockpitToolsWs').then(async ({ cockpitToolsWs }) => {
                if (!cockpitToolsWs.isConnected) { return; }
                

                const resp = await cockpitToolsWs.getAccounts();
                const account = resp.accounts.find(a => a.email === email);
                
                if (account && account.id) {
                    cockpitToolsWs.switchAccount(account.id);
                    logger.info(`[CredentialStorage] Notified Cockpit Tools to switch to account: ${email}`);
                }
            }).catch(() => {
            });
        } catch {
        }
    }
    */
    
    /**
     * Check if an account with given email already exists
     */
    async hasAccount(email: string): Promise<boolean> {
        const storage = await this.getCredentialsStorage();
        return email in storage.accounts;
    }

    /**
     * Save credential for a specific account
     * @returns 'added' if new account, 'duplicate' if already exists
     */
    async saveCredentialForAccount(
        email: string,
        credential: OAuthCredential,
        options?: { skipNotifyTools?: boolean },
    ): Promise<'added' | 'duplicate'> {
        const storage = await this.getCredentialsStorage();

        // Check for duplicate
        if (email in storage.accounts) {
            logger.warn(`[CredentialStorage] Account ${email} already exists, skipping`);
            return 'duplicate';
        }

        // Add new account
        storage.accounts[email] = credential;
        await this.saveCredentialsStorage(storage, options);

        // Set as active if it's the first account
        const accountCount = Object.keys(storage.accounts).length;
        if (accountCount === 1) {
            await this.setActiveAccount(email);
        }

        logger.info(`[CredentialStorage] Account ${email} added successfully`);
        

        if (!options?.skipNotifyTools) {
            this.syncAccountToCockpitTools(email, credential);
        }
        
        return 'added';
    }

    /**
     * Get credential for a specific account
     */
    async getCredentialForAccount(email: string): Promise<OAuthCredential | null> {
        const storage = await this.getCredentialsStorage();
        return storage.accounts[email] || null;
    }

    /**
     * Get all credentials
     */
    async getAllCredentials(): Promise<Record<string, OAuthCredential>> {
        await this.ensureMigrated();
        const storage = await this.getCredentialsStorage();
        return storage.accounts;
    }

    /**
     * Delete credential for a specific account
     */
    async deleteCredentialForAccount(email: string, _skipNotifyTools: boolean = false): Promise<void> {
        const storage = await this.getCredentialsStorage();

        if (!(email in storage.accounts)) {
            logger.warn(`[CredentialStorage] Account ${email} not found`);
            return;
        }

        delete storage.accounts[email];
        await this.saveCredentialsStorage(storage, _skipNotifyTools ? { skipNotifyTools: true } : undefined);
        await this.cleanupLegacyKeyForDeletedEmail(email);

        // If deleted account was active, set another as active
        const activeAccount = await this.getActiveAccount();
        if (activeAccount === email) {
            const remainingEmails = Object.keys(storage.accounts);
            if (remainingEmails.length > 0) {
                await this.setActiveAccount(remainingEmails[0]);
            } else {
                await this.setActiveAccount(null);
            }
        }

        logger.info(`[CredentialStorage] Account ${email} deleted`);
        

        if (!_skipNotifyTools) {
            this.deleteAccountFromCockpitTools(email);
        }
    }

    /**
     *
     */
    private async cleanupLegacyKeyForDeletedEmail(email: string): Promise<void> {
        try {
            const legacyJson = await this.secretStorage!.get(LEGACY_CREDENTIAL_KEY);
            if (!legacyJson) {
                return;
            }

            const legacyCredential = JSON.parse(legacyJson) as Partial<OAuthCredential>;
            const legacyEmail = (legacyCredential.email || '').trim().toLowerCase();
            const targetEmail = email.trim().toLowerCase();

            if (legacyEmail && legacyEmail === targetEmail) {
                await this.secretStorage!.delete(LEGACY_CREDENTIAL_KEY);
                logger.info(`[CredentialStorage] Legacy key cleared for deleted account: ${email}`);
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[CredentialStorage] Failed to cleanup legacy key for ${email}: ${err.message}`);
        }
    }

    /**
     *
     */
    async syncWithRemoteAccountList(remoteEmails: string[]): Promise<void> {
        await this.ensureMigrated();
        const storage = await this.getCredentialsStorage();
        const localEmails = Object.keys(storage.accounts);
        const remoteEmailSet = new Set(remoteEmails);
        
        let changed = false;
        
        for (const email of localEmails) {
            if (!remoteEmailSet.has(email)) {
                logger.info(`[CredentialStorage] Syncing: Account ${email} not found in remote, deleting locally`);

                await this.deleteCredentialForAccount(email, true);
                changed = true;
            }
        }
        
        if (changed) {
            logger.info('[CredentialStorage] Synced with remote account list');
        }
    }

    /**
     * Mark an account as invalid (refresh token failed)
     */
    async markAccountInvalid(email: string, invalid: boolean = true): Promise<void> {
        const storage = await this.getCredentialsStorage();
        
        if (!(email in storage.accounts)) {
            logger.warn(`[CredentialStorage] Account ${email} not found for marking invalid`);
            return;
        }

        storage.accounts[email].isInvalid = invalid;
        await this.saveCredentialsStorage(storage);
        
        logger.info(`[CredentialStorage] Account ${email} marked as ${invalid ? 'invalid' : 'valid'}`);
    }

    /**
     * Clear invalid status when re-authorization succeeds
     */
    async clearAccountInvalid(email: string): Promise<void> {
        await this.markAccountInvalid(email, false);
    }

    /**
     * Mark an account as forbidden (403 from Cloud Code)
     */
    async markAccountForbidden(email: string, forbidden: boolean = true): Promise<void> {
        const storage = await this.getCredentialsStorage();

        if (!(email in storage.accounts)) {
            logger.warn(`[CredentialStorage] Account ${email} not found for marking forbidden`);
            return;
        }

        storage.accounts[email].isForbidden = forbidden;
        await this.saveCredentialsStorage(storage);

        logger.info(`[CredentialStorage] Account ${email} marked as ${forbidden ? 'forbidden' : 'normal'}`);
    }

    /**
     * Clear forbidden status when refresh succeeds
     */
    async clearAccountForbidden(email: string): Promise<void> {
        await this.markAccountForbidden(email, false);
    }


    /**
     *
     */
    getToolsAccountSnapshot(): string[] {
        this.ensureInitialized();
        return this.globalState!.get<string[]>(TOOLS_ACCOUNT_SNAPSHOT_KEY, []);
    }

    /**
     *
     */
    async setToolsAccountSnapshot(emails: string[]): Promise<void> {
        this.ensureInitialized();
        const unique = Array.from(new Set(emails));
        await this.globalState!.update(TOOLS_ACCOUNT_SNAPSHOT_KEY, unique);
    }

    /**
     * Set the active account
     * Also syncs to legacy key for backward compatibility with older versions
     */
    async setActiveAccount(email: string | null, _skipNotifyTools: boolean = false): Promise<void> {
        this.ensureInitialized();
        await this.globalState!.update(ACTIVE_ACCOUNT_KEY, email);
        logger.info(`[CredentialStorage] Active account set to: ${email || 'none'}`);

        // Backward compatibility: sync to legacy key so older versions can read it
        await this.syncToLegacyKey(email);
        

        /*
        if (email && !skipNotifyTools) {
            this.syncSwitchToCockpitTools(email);
        }
        */
    }

    /**
     * Sync active account's credential to legacy key for backward compatibility
     */
    private async syncToLegacyKey(email: string | null): Promise<void> {
        try {
            if (!email) {
                // No active account, clear legacy key
                await this.secretStorage!.delete(LEGACY_CREDENTIAL_KEY);
                logger.info('[CredentialStorage] Legacy key cleared (no active account)');
                return;
            }

            const credential = await this.getCredentialForAccount(email);
            if (credential) {
                // Write to legacy key so older versions can read it
                await this.secretStorage!.store(LEGACY_CREDENTIAL_KEY, JSON.stringify(credential));
                logger.info(`[CredentialStorage] Synced ${email} to legacy key for backward compatibility`);
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[CredentialStorage] Failed to sync to legacy key: ${err.message}`);
        }
    }

    /**
     * Get the active account email
     */
    async getActiveAccount(): Promise<string | null> {
        this.ensureInitialized();
        return this.globalState!.get<string | null>(ACTIVE_ACCOUNT_KEY, null);
    }

    /**
     * Get all account info for UI display
     */
    async getAccountInfoList(): Promise<AccountInfo[]> {
        await this.ensureMigrated();
        const storage = await this.getCredentialsStorage();
        const activeAccount = await this.getActiveAccount();

        return Object.entries(storage.accounts).map(([email, credential]) => ({
            email,
            isActive: email === activeAccount,
            expiresAt: credential.expiresAt,
            isInvalid: credential.isInvalid,
        }));
    }

    // ============ Legacy Compatibility Methods ============

    /**
     * Migrate from legacy single-account format to multi-account
     */
    private async migrateFromLegacy(): Promise<void> {
        this.ensureInitialized();

        try {
            // Check if legacy credential exists
            const legacyJson = await this.secretStorage!.get(LEGACY_CREDENTIAL_KEY);
            if (!legacyJson) {
                return; // No legacy data
            }

            // Check if already migrated
            const storage = await this.getCredentialsStorage();
            if (Object.keys(storage.accounts).length > 0) {
                // Already have multi-account data, delete legacy
                await this.secretStorage!.delete(LEGACY_CREDENTIAL_KEY);
                logger.info('[CredentialStorage] Legacy credential cleaned up (already migrated)');
                return;
            }

            // Parse legacy credential
            const legacyCredential = JSON.parse(legacyJson) as OAuthCredential;
            if (!legacyCredential.email || !legacyCredential.refreshToken) {
                // Invalid legacy data, just delete it
                await this.secretStorage!.delete(LEGACY_CREDENTIAL_KEY);
                logger.info('[CredentialStorage] Invalid legacy credential deleted');
                return;
            }

            // Migrate to multi-account format
            storage.accounts[legacyCredential.email] = legacyCredential;
            await this.saveCredentialsStorage(storage);
            await this.setActiveAccount(legacyCredential.email);

            // Delete legacy key
            await this.secretStorage!.delete(LEGACY_CREDENTIAL_KEY);

            logger.info(`[CredentialStorage] Migrated legacy account: ${legacyCredential.email}`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[CredentialStorage] Migration error: ${err.message}`);
        }
    }

    /**
     *
     * @deprecated Use saveCredentialForAccount instead
     */
    async saveCredential(credential: OAuthCredential): Promise<void> {
        if (!credential.email) {
            throw new Error('Credential must have an email');
        }

        const storage = await this.getCredentialsStorage();
        storage.accounts[credential.email] = credential;
        await this.saveCredentialsStorage(storage);

        // Set as active if no active account
        const activeAccount = await this.getActiveAccount();
        if (!activeAccount) {
            await this.setActiveAccount(credential.email);
        } else if (activeAccount === credential.email) {
            // If updating active account, sync to legacy key
            await this.syncToLegacyKey(credential.email);
        }

        logger.info(`[CredentialStorage] Credential saved for ${credential.email}`);
        

        this.syncAccountToCockpitTools(credential.email, credential);
    }

    /**
     *
     */
    async getCredential(): Promise<OAuthCredential | null> {
        await this.ensureMigrated();
        const activeAccount = await this.getActiveAccount();
        if (!activeAccount) {
            // Check if there are any accounts
            const storage = await this.getCredentialsStorage();
            const emails = Object.keys(storage.accounts);
            if (emails.length > 0) {
                // Auto-set first account as active
                await this.setActiveAccount(emails[0]);
                return storage.accounts[emails[0]];
            }
            return null;
        }

        return await this.getCredentialForAccount(activeAccount);
    }

    /**
     *
     */
    async deleteCredential(): Promise<void> {
        this.ensureInitialized();
        try {
            await this.secretStorage!.delete(CREDENTIALS_KEY);
            await this.setActiveAccount(null);
            logger.info('[CredentialStorage] All credentials deleted');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[CredentialStorage] Failed to delete credentials: ${err.message}`);
            throw err;
        }
    }

    /**
     *
     */
    async hasValidCredential(): Promise<boolean> {
        await this.ensureMigrated();
        const credential = await this.getCredential();
        if (!credential) {
            return false;
        }


        if (!credential.refreshToken) {
            return false;
        }

        return true;
    }

    /**
     *
     */
    async getAuthorizationStatus(): Promise<AuthorizationStatus> {
        await this.ensureMigrated();
        const credential = await this.getCredential();
        const accounts = await this.getAccountInfoList();
        const activeAccount = await this.getActiveAccount();

        if (!credential || !credential.refreshToken) {
            return {
                isAuthorized: false,
                accounts,
                activeAccount: activeAccount || undefined,
            };
        }

        return {
            isAuthorized: true,
            email: credential.email,
            expiresAt: credential.expiresAt,
            accounts,
            activeAccount: activeAccount || undefined,
        };
    }

    /**
     *
     */
    async updateAccessToken(accessToken: string, expiresAt: string): Promise<void> {
        const activeAccount = await this.getActiveAccount();
        if (!activeAccount) {
            throw new Error('No active account to update');
        }

        const credential = await this.getCredentialForAccount(activeAccount);
        if (!credential) {
            throw new Error('No credential to update');
        }

        credential.accessToken = accessToken;
        credential.expiresAt = expiresAt;

        const storage = await this.getCredentialsStorage();
        storage.accounts[activeAccount] = credential;

        await this.saveCredentialsStorage(storage, { skipNotifyTools: true });

        // Sync to legacy key for backward compatibility
        await this.syncToLegacyKey(activeAccount);

        logger.info(`[CredentialStorage] Access token updated for ${activeAccount}`);
    }

    /**
     *
     */
    async updateAccessTokenForAccount(email: string, accessToken: string, expiresAt: string): Promise<void> {
        const credential = await this.getCredentialForAccount(email);
        if (!credential) {
            throw new Error(`No credential to update for ${email}`);
        }

        credential.accessToken = accessToken;
        credential.expiresAt = expiresAt;

        const storage = await this.getCredentialsStorage();
        storage.accounts[email] = credential;

        await this.saveCredentialsStorage(storage, { skipNotifyTools: true });

        // Sync to legacy key if this is the active account
        const activeAccount = await this.getActiveAccount();
        if (activeAccount === email) {
            await this.syncToLegacyKey(email);
        }

        logger.info(`[CredentialStorage] Access token updated for ${email}`);
    }

    /**
     *
     */
    async updateProjectIdForAccount(email: string, projectId: string): Promise<void> {
        const credential = await this.getCredentialForAccount(email);
        if (!credential) {
            throw new Error(`No credential to update for ${email}`);
        }

        credential.projectId = projectId;
        const storage = await this.getCredentialsStorage();
        storage.accounts[email] = credential;

        await this.saveCredentialsStorage(storage, { skipNotifyTools: true });

        logger.info(`[CredentialStorage] ProjectId updated for ${email}`);
    }

    /**
     *
     */
    async saveState<T>(key: string, value: T): Promise<void> {
        this.ensureInitialized();
        await this.globalState!.update(`${STATE_KEY}.${key}`, value);
    }

    /**
     *
     */
    getState<T>(key: string, defaultValue: T): T {
        this.ensureInitialized();
        return this.globalState!.get(`${STATE_KEY}.${key}`, defaultValue);
    }
}

export const credentialStorage = new CredentialStorage();
