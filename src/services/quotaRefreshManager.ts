/**
 * Antigravity Cockpit -
 *
 */

import { logger } from '../shared/log_service';
import { ReactorCore } from '../engine/reactor';
import { QuotaSnapshot } from '../shared/types';
import { readQuotaApiCache, isApiCacheValid, getApiCacheAge } from './quota_api_cache';
import { credentialStorage } from '../auto_trigger';
import { recordQuotaHistory } from './quota_history';

export interface RefreshOptions {
    forceRefresh?: boolean;
    reason?: string;
}

export interface RefreshResult {
    success: boolean;
    fromCache: boolean;
    snapshot?: QuotaSnapshot;
    error?: string;
}

/**
 *
 *
 */
export class QuotaRefreshManager {
    private refreshingAccounts = new Set<string>();
    private lastNetworkRefreshAt = new Map<string, number>();

    constructor(private readonly reactor: ReactorCore) {}

    /**
     *
     * @param email
     * @param options
     * @returns
     */
    async refreshAccount(email: string, options?: RefreshOptions): Promise<RefreshResult> {
        const reason = options?.reason ?? 'manual';
        const forceRefresh = options?.forceRefresh ?? false;

        while (this.refreshingAccounts.has(email)) {
            logger.debug(`[QuotaRefresh] Account ${email} is already refreshing, waiting...`);
            const waitStartedAt = Date.now();
            await this.waitForRefresh(email);
            const cachedSnapshot = await this.tryUseApiCache(email, reason, waitStartedAt, forceRefresh);
            if (cachedSnapshot) {
                return {
                    success: true,
                    fromCache: true,
                    snapshot: cachedSnapshot,
                };
            }
        }

        try {
            this.refreshingAccounts.add(email);

            if (!forceRefresh) {
                const cachedSnapshot = await this.tryUseApiCache(email, reason);
                if (cachedSnapshot) {
                    return {
                        success: true,
                        fromCache: true,
                        snapshot: cachedSnapshot,
                    };
                }
            }


            logger.info(`[QuotaRefresh] Fetching quota for ${email} from network (force: ${forceRefresh}, reason: ${reason})`);
            
            const { snapshot, fromApiCacheFile } = await this.reactor.fetchQuotaForAccountWithSource(email, { forceRefresh });
            this.lastNetworkRefreshAt.set(email, Date.now());
            

            if (!fromApiCacheFile) {
                void recordQuotaHistory(email, snapshot);
            } else {
                logger.debug(`[QuotaRefresh] Skip history record for ${email} because data comes from api cache file`);
            }

            logger.info(`[QuotaRefresh] Refreshed ${email}: ${snapshot.models.length} models`);
            
            return {
                success: true,
                fromCache: false,
                snapshot,
            };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            logger.error(`[QuotaRefresh] Failed to refresh ${email}: ${error}`);
            
            return {
                success: false,
                fromCache: false,
                error,
            };
        } finally {
            this.refreshingAccounts.delete(email);
        }
    }

    /**
     *
     * @param emails
     * @param options
     * @returns
     */
    async refreshAccounts(emails: string[], options?: RefreshOptions): Promise<Map<string, RefreshResult>> {
        const results = new Map<string, RefreshResult>();
        const reason = options?.reason ?? 'batch';

        for (const email of emails) {
            const result = await this.refreshAccount(email, { 
                ...options, 
                reason,

                forceRefresh: options?.forceRefresh ?? false,
            });
            results.set(email, result);
        }

        return results;
    }

    /**
     *
     * @param options
     * @returns
     */
    async refreshAll(options?: RefreshOptions): Promise<Map<string, RefreshResult>> {
        const credentials = await credentialStorage.getAllCredentials();
        const emails = Object.keys(credentials).filter(email => {
            const cred = credentials[email];
            return cred && !cred.isInvalid && !cred.isForbidden;
        });

        logger.info(`[QuotaRefresh] Refreshing all ${emails.length} accounts (reason: ${options?.reason ?? 'all'})`);
        return this.refreshAccounts(emails, options);
    }

    /**
     *
     */
    private async waitForRefresh(email: string, timeoutMs: number = 30000): Promise<void> {
        const startTime = Date.now();
        while (this.refreshingAccounts.has(email)) {
            if (Date.now() - startTime > timeoutMs) {
                throw new Error(`Timeout waiting for refresh of ${email}`);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    private async tryUseApiCache(
        email: string,
        reason: string,
        waitStartedAt?: number,
        forceRefresh?: boolean,
    ): Promise<QuotaSnapshot | null> {
        const cached = await readQuotaApiCache('authorized', email);
        if (!isApiCacheValid(cached)) {
            return null;
        }
        if (forceRefresh && waitStartedAt !== undefined) {
            const lastNetworkAt = this.lastNetworkRefreshAt.get(email);
            if (lastNetworkAt === undefined || lastNetworkAt < waitStartedAt) {
                return null;
            }
        }
        const age = getApiCacheAge(cached);
        logger.info(`[QuotaRefresh] Using api cache for ${email} (age: ${Math.round(age / 1000)}s, reason: ${reason})`);
        const snapshot = this.reactor.buildAuthorizedSnapshotFromResponse(cached!.payload, cached!.updatedAt);
        try {
            const credits = await this.reactor.fetchAvailableAICreditsForAccount(email);
            if (Number.isFinite(credits)) {
                snapshot.availableAICredits = Math.max(0, Number(credits));
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[QuotaRefresh] Failed to enrich credits for ${email}: ${err.message}`);
        }
        return snapshot;
    }
}
