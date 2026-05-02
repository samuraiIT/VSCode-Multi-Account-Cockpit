/**
 * Antigravity Cockpit - Auto Trigger Controller
 *
 *
 */

import * as vscode from 'vscode';
import { credentialStorage } from './credential_storage';
import { oauthService } from './oauth_service';
import { schedulerService, CronParser } from './scheduler_service';
import { triggerService } from './trigger_service';
import {
    AutoTriggerState,
    ScheduleConfig,
    AutoTriggerMessage,
    SCHEDULE_PRESETS,
} from './types';
import { logger } from '../shared/log_service';
import { t } from '../shared/i18n';
import { DEPRECATED_MODEL_KEY_REPLACEMENTS } from '../shared/model_preference_migration';

/**
 *
 */
interface QuotaModelInfo {
    id: string;
    displayName: string;
    modelConstant: string;
    resetTime?: Date;
    remainingFraction?: number;
}

const SCHEDULE_CONFIG_KEY = 'scheduleConfig';
const DEFAULT_AUTO_TRIGGER_MODEL = 'gemini-3-flash';
const TIME_24H_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LEGACY_AUTO_TRIGGER_MODEL_REPLACEMENTS = new Map<string, string>(
    Object.entries(DEPRECATED_MODEL_KEY_REPLACEMENTS).map(([from, to]) => [from.toLowerCase(), to]),
);

/**
 *
 */
class AutoTriggerController {
    private initialized = false;
    private messageHandler?: (message: AutoTriggerMessage) => void;
    private quotaModelConstants: string[] = [];
    private modelIdToConstant: Map<string, string> = new Map();
    private fallbackTimers: ReturnType<typeof setTimeout>[] = [];
    private accountOperationLock: Promise<void> = Promise.resolve();

    /**
     *
     *
     */
    private async withAccountLock<T>(operation: () => Promise<T>): Promise<T> {
        const previousLock = this.accountOperationLock;
        let releaseLock: () => void;
        this.accountOperationLock = new Promise<void>(resolve => {
            releaseLock = resolve;
        });

        try {
            await previousLock;
            return await operation();
        } finally {
            releaseLock!();
        }
    }

    private createDefaultScheduleConfig(): ScheduleConfig {
        return {
            enabled: false,
            repeatMode: 'daily',
            dailyTimes: ['08:00'],
            weeklyDays: [1, 2, 3, 4, 5],
            weeklyTimes: ['08:00'],
            intervalHours: 4,
            intervalStartTime: '07:00',
            intervalEndTime: '22:00',
            selectedModels: [DEFAULT_AUTO_TRIGGER_MODEL],
            wakeOnReset: false,
            timeWindowEnabled: false,
            timeWindowStart: '09:00',
            timeWindowEnd: '18:00',
            fallbackTimes: ['07:00'],
            maxOutputTokens: 0,
        };
    }

    private normalizeStringArray(values: unknown): string[] {
        if (!Array.isArray(values)) {
            return [];
        }
        const result: string[] = [];
        const seen = new Set<string>();
        for (const value of values) {
            if (typeof value !== 'string') {
                continue;
            }
            const trimmed = value.trim();
            if (!trimmed) {
                continue;
            }
            const key = trimmed.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push(trimmed);
        }
        return result;
    }

    private normalizeTimeValue(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }
        const trimmed = value.trim();
        return TIME_24H_REGEX.test(trimmed) ? trimmed : undefined;
    }

    private normalizeTimeArray(values: unknown): string[] {
        const normalized: string[] = [];
        const seen = new Set<string>();
        for (const value of this.normalizeStringArray(values)) {
            const time = this.normalizeTimeValue(value);
            if (!time || seen.has(time)) {
                continue;
            }
            seen.add(time);
            normalized.push(time);
        }
        return normalized;
    }

    private normalizeWeekDays(values: unknown): number[] {
        if (!Array.isArray(values)) {
            return [];
        }
        const normalized: number[] = [];
        const seen = new Set<number>();
        for (const value of values) {
            const parsed = typeof value === 'number'
                ? value
                : (typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN);
            if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6 || seen.has(parsed)) {
                continue;
            }
            seen.add(parsed);
            normalized.push(parsed);
        }
        return normalized.sort((a, b) => a - b);
    }

    private normalizeSelectedModels(
        values: unknown,
        availableModelIds?: Set<string>,
    ): string[] {
        const normalized: string[] = [];
        const seen = new Set<string>();

        for (const rawModelId of this.normalizeStringArray(values)) {
            const replacement = LEGACY_AUTO_TRIGGER_MODEL_REPLACEMENTS.get(rawModelId.toLowerCase()) || rawModelId;
            const key = replacement.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            if (availableModelIds && availableModelIds.size > 0 && !availableModelIds.has(replacement)) {
                continue;
            }
            seen.add(key);
            normalized.push(replacement);
        }

        return normalized;
    }

    private normalizeSelectedAccounts(
        values: unknown,
        availableAccountEmails?: Set<string>,
    ): string[] {
        const normalized: string[] = [];
        const seen = new Set<string>();
        const availableByLower = new Map<string, string>();

        if (availableAccountEmails) {
            for (const email of availableAccountEmails) {
                availableByLower.set(email.toLowerCase(), email);
            }
        }

        for (const rawEmail of this.normalizeStringArray(values)) {
            const key = rawEmail.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            if (availableByLower.size > 0) {
                const resolved = availableByLower.get(key);
                if (!resolved) {
                    continue;
                }
                seen.add(resolved.toLowerCase());
                normalized.push(resolved);
                continue;
            }
            seen.add(key);
            normalized.push(rawEmail);
        }

        return normalized;
    }

    private normalizeScheduleConfig(
        rawConfig: ScheduleConfig | null | undefined,
        availableModelIds?: Set<string>,
        availableAccountEmails?: Set<string>,
    ): ScheduleConfig {
        const defaults = this.createDefaultScheduleConfig();
        const source: Partial<ScheduleConfig> = rawConfig && typeof rawConfig === 'object'
            ? rawConfig
            : {};

        const normalized: ScheduleConfig = {
            ...defaults,
            dailyTimes: [...(defaults.dailyTimes || [])],
            weeklyDays: [...(defaults.weeklyDays || [])],
            weeklyTimes: [...(defaults.weeklyTimes || [])],
            selectedModels: [...defaults.selectedModels],
            fallbackTimes: [...(defaults.fallbackTimes || [])],
        };

        normalized.enabled = Boolean(source.enabled);

        if (source.repeatMode === 'daily' || source.repeatMode === 'weekly' || source.repeatMode === 'interval') {
            normalized.repeatMode = source.repeatMode;
        }

        const dailyTimes = this.normalizeTimeArray(source.dailyTimes);
        if (dailyTimes.length > 0) {
            normalized.dailyTimes = dailyTimes;
        }

        const weeklyDays = this.normalizeWeekDays(source.weeklyDays);
        if (weeklyDays.length > 0) {
            normalized.weeklyDays = weeklyDays;
        }

        const weeklyTimes = this.normalizeTimeArray(source.weeklyTimes);
        if (weeklyTimes.length > 0) {
            normalized.weeklyTimes = weeklyTimes;
        }

        if (typeof source.intervalHours === 'number' && Number.isFinite(source.intervalHours) && source.intervalHours > 0) {
            normalized.intervalHours = Math.floor(source.intervalHours);
        }

        const intervalStart = this.normalizeTimeValue(source.intervalStartTime);
        if (intervalStart) {
            normalized.intervalStartTime = intervalStart;
        }

        const intervalEnd = this.normalizeTimeValue(source.intervalEndTime);
        if (intervalEnd) {
            normalized.intervalEndTime = intervalEnd;
        }

        if (Array.isArray(source.selectedModels)) {
            normalized.selectedModels = this.normalizeSelectedModels(source.selectedModels, availableModelIds);
        }

        if (Array.isArray(source.selectedAccounts)) {
            normalized.selectedAccounts = this.normalizeSelectedAccounts(source.selectedAccounts, availableAccountEmails);
        } else {
            normalized.selectedAccounts = undefined;
        }

        const crontab = typeof source.crontab === 'string' ? source.crontab.trim() : '';
        normalized.crontab = crontab || undefined;

        normalized.wakeOnReset = Boolean(source.wakeOnReset);
        normalized.timeWindowEnabled = normalized.wakeOnReset && Boolean(source.timeWindowEnabled);

        const timeWindowStart = this.normalizeTimeValue(source.timeWindowStart);
        const timeWindowEnd = this.normalizeTimeValue(source.timeWindowEnd);
        const fallbackTimes = this.normalizeTimeArray(source.fallbackTimes);
        if (normalized.timeWindowEnabled) {
            normalized.timeWindowStart = timeWindowStart || defaults.timeWindowStart;
            normalized.timeWindowEnd = timeWindowEnd || defaults.timeWindowEnd;
            normalized.fallbackTimes = fallbackTimes.length > 0 ? fallbackTimes : [...(defaults.fallbackTimes || [])];
        } else {
            normalized.timeWindowStart = undefined;
            normalized.timeWindowEnd = undefined;
            normalized.fallbackTimes = undefined;
        }

        const customPrompt = typeof source.customPrompt === 'string' ? source.customPrompt.trim() : '';
        normalized.customPrompt = customPrompt || undefined;

        if (typeof source.maxOutputTokens === 'number' && Number.isFinite(source.maxOutputTokens) && source.maxOutputTokens >= 0) {
            normalized.maxOutputTokens = Math.floor(source.maxOutputTokens);
        } else {
            normalized.maxOutputTokens = 0;
        }

        if (!normalized.enabled || normalized.selectedModels.length === 0) {
            normalized.enabled = false;
            normalized.wakeOnReset = false;
            normalized.timeWindowEnabled = false;
            normalized.timeWindowStart = undefined;
            normalized.timeWindowEnd = undefined;
            normalized.fallbackTimes = undefined;
        }

        return normalized;
    }

    private async buildCanonicalScheduleConfig(rawConfig: ScheduleConfig | null | undefined): Promise<ScheduleConfig> {
        let availableModelIds: Set<string> | undefined;
        try {
            const availableModels = await triggerService.fetchAvailableModels(this.quotaModelConstants);
            if (availableModels.length > 0) {
                availableModelIds = new Set(availableModels.map(model => model.id));
            }
        } catch (error) {
            logger.warn(`[AutoTriggerController] Failed to load available models when normalizing schedule: ${error}`);
        }

        const allCredentials = await credentialStorage.getAllCredentials();
        const availableAccountEmails = new Set(Object.keys(allCredentials));

        return this.normalizeScheduleConfig(rawConfig, availableModelIds, availableAccountEmails);
    }


    /**
     *
     */
    setQuotaModels(modelConstants: string[]): void {
        this.quotaModelConstants = modelConstants;
        logger.debug(`[AutoTriggerController] Quota model constants set: ${modelConstants.join(', ')}`);
    }

    /**
     *
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (this.initialized) {
            return;
        }

        credentialStorage.initialize(context);

        triggerService.initialize();

        const savedConfig = credentialStorage.getState<ScheduleConfig | null>(SCHEDULE_CONFIG_KEY, null);
        if (savedConfig) {
            const normalizedSavedConfig = await this.buildCanonicalScheduleConfig(savedConfig);
            await credentialStorage.saveState(SCHEDULE_CONFIG_KEY, normalizedSavedConfig);

            if (normalizedSavedConfig.wakeOnReset && normalizedSavedConfig.enabled) {
                logger.info('[AutoTriggerController] Wake on reset mode enabled, scheduler not started');

                if (normalizedSavedConfig.timeWindowEnabled && normalizedSavedConfig.fallbackTimes?.length) {
                    this.startFallbackScheduler(normalizedSavedConfig);
                }
            } else if (normalizedSavedConfig.enabled) {
                logger.info('[AutoTriggerController] Restoring schedule from saved config');
                schedulerService.setSchedule(normalizedSavedConfig, () => this.executeTrigger());
            }
        }

        this.initialized = true;
        logger.info('[AutoTriggerController] Initialized');
    }

    /**
     *
     */
    private async updateStatusBar(): Promise<void> {
    }

    /**
     *
     */
    async getState(): Promise<AutoTriggerState> {
        const authorization = await credentialStorage.getAuthorizationStatus();
        const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, this.createDefaultScheduleConfig());

        const nextRunTime = schedulerService.getNextRunTime();
        const availableModels = await triggerService.fetchAvailableModels(this.quotaModelConstants);


        this.modelIdToConstant.clear();
        for (const model of availableModels) {
            if (model.id && model.modelConstant) {
                this.modelIdToConstant.set(model.id, model.modelConstant);
            }
        }
        logger.debug(`[AutoTriggerController] Updated modelIdToConstant mapping: ${this.modelIdToConstant.size} entries`);

        return {
            authorization,
            schedule,
            lastTrigger: triggerService.getLastTrigger(),
            recentTriggers: triggerService.getRecentTriggers(),
            nextTriggerTime: nextRunTime?.toISOString(),
            availableModels,
        };
    }

    /**
     *
     */
    async startAuthorization(): Promise<boolean> {
        return await oauthService.startAuthorization();
    }

    /**
     *
     */
    async authorize(): Promise<boolean> {
        return this.startAuthorization();
    }

    /**
     *
     */
    async revokeAuthorization(): Promise<void> {
        await oauthService.revokeAuthorization();
        schedulerService.stop();
        const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
            enabled: false,
            repeatMode: 'daily',
            selectedModels: ['gemini-3-flash'],
            maxOutputTokens: 0,
        });
        schedule.enabled = false;
        await credentialStorage.saveState(SCHEDULE_CONFIG_KEY, schedule);
        this.updateStatusBar();
    }

    /**
     *
     */
    async revokeActiveAccount(): Promise<void> {
        const activeAccount = await credentialStorage.getActiveAccount();
        if (!activeAccount) {
            await this.revokeAuthorization();
            return;
        }
        await this.removeAccount(activeAccount);
    }

    /**
     *
     * @param email
     */
    async removeAccount(email: string): Promise<void> {
        return this.withAccountLock(async () => {
            await oauthService.revokeAccount(email);

            const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
                enabled: false,
                repeatMode: 'daily',
                selectedModels: ['gemini-3-flash'],
                maxOutputTokens: 0,
            });
            const remainingCredentials = await credentialStorage.getAllCredentials();
            const remainingEmails = Object.keys(remainingCredentials);
            const _activeAccount = await credentialStorage.getActiveAccount();
            let scheduleChanged = false;

            if (Array.isArray(schedule.selectedAccounts)) {
                const filtered = schedule.selectedAccounts.filter(account => remainingEmails.includes(account));
                if (filtered.length !== schedule.selectedAccounts.length) {
                    schedule.selectedAccounts = filtered;
                    scheduleChanged = true;

                    if (filtered.length === 0 && schedule.enabled) {
                        schedule.enabled = false;
                        schedulerService.stop();
                        this.stopFallbackScheduler();
                        logger.info('[AutoTriggerController] All selected accounts removed, disabling schedule');
                    }
                }
            }

            // Check if there are remaining accounts
            const hasAuth = await credentialStorage.hasValidCredential();
            if (!hasAuth) {
                // No accounts left, stop scheduler and disable schedule
                schedulerService.stop();
                if (schedule.enabled) {
                    schedule.enabled = false;
                    scheduleChanged = true;
                }
            }

            if (scheduleChanged) {
                await credentialStorage.saveState(SCHEDULE_CONFIG_KEY, schedule);
            }

            this.updateStatusBar();
            this.notifyStateUpdate();
        });
    }

    /**
     *
     * @param email
     */
    async switchAccount(email: string): Promise<void> {
        return this.withAccountLock(async () => {
            await credentialStorage.setActiveAccount(email);
            logger.info(`[AutoTriggerController] Switched to account: ${email}`);
            this.notifyStateUpdate();
        });
    }

    /**
     *
     * @param email
     */
    async reauthorizeAccount(email: string): Promise<void> {
        await credentialStorage.setActiveAccount(email);
        logger.info(`[AutoTriggerController] Reauthorizing account: ${email}`);
        
        const success = await oauthService.startAuthorization();
        if (!success) {
            throw new Error('Reauthorization cancelled or failed');
        }
        
        this.notifyStateUpdate();
    }

    /**
     *
     */
    async saveSchedule(config: ScheduleConfig): Promise<void> {
        const normalizedConfig = await this.buildCanonicalScheduleConfig(config);

        if (normalizedConfig.crontab) {
            const result = schedulerService.validateCrontab(normalizedConfig.crontab);
            if (!result.valid) {
                throw new Error(`Invalid crontab expression: ${result.error}`);
            }
        }

        await credentialStorage.saveState(SCHEDULE_CONFIG_KEY, normalizedConfig);




        if (normalizedConfig.wakeOnReset && normalizedConfig.enabled) {
            schedulerService.stop();
            this.stopFallbackScheduler();
            logger.info('[AutoTriggerController] Schedule saved, wakeOnReset mode enabled');

            if (normalizedConfig.timeWindowEnabled && normalizedConfig.fallbackTimes?.length) {
                this.startFallbackScheduler(normalizedConfig);
            }
        } else if (normalizedConfig.enabled) {

            this.stopFallbackScheduler();
            const accounts = await this.resolveAccountsFromList(normalizedConfig.selectedAccounts);
            if (accounts.length === 0) {
                throw new Error('Please authorize first');
            }
            schedulerService.setSchedule(normalizedConfig, () => this.executeTrigger());
            logger.info(`[AutoTriggerController] Schedule saved, enabled=${normalizedConfig.enabled}`);
        } else {
            schedulerService.stop();
            this.stopFallbackScheduler();
            logger.info('[AutoTriggerController] Schedule saved, all triggers disabled');
        }

        this.updateStatusBar();
    }

    /**
     *
     */
    private async resolveAccountsFromList(requestedAccounts?: string[]): Promise<string[]> {
        const allCredentials = await credentialStorage.getAllCredentials();
        const allEmails = Object.keys(allCredentials);
        if (allEmails.length === 0) {
            return [];
        }


        if (Array.isArray(requestedAccounts)) {
            return requestedAccounts.filter(email => (email in allCredentials) && Boolean(allCredentials[email]?.refreshToken));
        }

        const candidates: string[] = [];
        const active = await credentialStorage.getActiveAccount();
        if (active && (active in allCredentials)) {
            candidates.push(active);
        } else if (allEmails.length > 0) {
            candidates.push(allEmails[0]);
        }

        return candidates.filter(email => Boolean(allCredentials[email]?.refreshToken));
    }

    /**
     *
     */
    private async resolveScheduleAccounts(schedule: ScheduleConfig): Promise<string[]> {
        return this.resolveAccountsFromList(schedule.selectedAccounts);
    }

    /**
     *
     * @param models
     */
    async testTrigger(models?: string[], accounts?: string[], maxOutputTokens?: number): Promise<void> {
        const targetAccounts = await this.resolveAccountsFromList(accounts);
        if (targetAccounts.length === 0) {
            vscode.window.showErrorMessage(t('autoTrigger.authRequired'));
            return;
        }

        vscode.window.showInformationMessage(t('autoTrigger.triggeringNotify'));

        let selectedModels = models;
        if (!selectedModels || selectedModels.length === 0) {
            const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
                enabled: false,
                repeatMode: 'daily',
                selectedModels: ['gemini-3-flash'],
                maxOutputTokens: 0,
            });
            selectedModels = schedule.selectedModels || ['gemini-3-flash'];
        }
        const resolvedMaxOutputTokens = this.resolveMaxOutputTokens(maxOutputTokens);

        let anySuccess = false;
        let totalDuration = 0;
        let firstError: string | undefined;

        for (const email of targetAccounts) {
            const result = await triggerService.trigger(selectedModels, 'manual', undefined, 'manual', email, resolvedMaxOutputTokens);
            totalDuration += result.duration || 0;
            if (result.success) {
                anySuccess = true;
            } else if (!firstError) {
                firstError = result.message;
            }
        }

        if (anySuccess) {
            vscode.window.showInformationMessage(t('autoTrigger.testTriggerSuccess', { duration: totalDuration }));
        } else {
            vscode.window.showErrorMessage(t('autoTrigger.testTriggerFailed', { error: firstError || t('common.unknownError') }));
        }


        this.notifyStateUpdate();
    }

    /**
     *
     * @param models
     * @param customPrompt
     */
    async triggerNow(
        models?: string[],
        customPrompt?: string,
        accounts?: string[],
        maxOutputTokens?: number,
    ): Promise<{ success: boolean; duration?: number; error?: string; response?: string }> {
        const targetAccounts = await this.resolveAccountsFromList(accounts);
        if (targetAccounts.length === 0) {
            return { success: false, error: 'Please authorize first' };
        }

        let selectedModels = models;
        if (!selectedModels || selectedModels.length === 0) {
            const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
                enabled: false,
                repeatMode: 'daily',
                selectedModels: ['gemini-3-flash'],
                maxOutputTokens: 0,
            });
            selectedModels = schedule.selectedModels || ['gemini-3-flash'];
        }
        const resolvedMaxOutputTokens = this.resolveMaxOutputTokens(maxOutputTokens);

        let anySuccess = false;
        let totalDuration = 0;
        let firstResponse: string | undefined;
        let firstError: string | undefined;

        for (const email of targetAccounts) {
            const result = await triggerService.trigger(selectedModels, 'manual', customPrompt, 'manual', email, resolvedMaxOutputTokens);
            totalDuration += result.duration || 0;
            if (result.success) {
                anySuccess = true;
                if (!firstResponse) {
                    firstResponse = result.message;
                }
            } else if (!firstError) {
                firstError = result.message;
            }
        }


        this.notifyStateUpdate();

        return {
            success: anySuccess,
            duration: totalDuration || undefined,
            error: anySuccess ? undefined : (firstError || 'Unknown error'),
            response: anySuccess ? firstResponse : undefined,
        };
    }

    /**
     *
     */
    async clearHistory(): Promise<void> {
        triggerService.clearHistory();
        this.notifyStateUpdate();
    }

    /**
     *
     */
    private async executeTrigger(): Promise<void> {
        const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
            enabled: false,
            repeatMode: 'daily',
            selectedModels: ['gemini-3-flash'],
            maxOutputTokens: 0,
        });
        const triggerSource = schedule.crontab ? 'crontab' : 'scheduled';
        const accounts = await this.resolveScheduleAccounts(schedule);
        if (accounts.length === 0) {
            logger.warn('[AutoTriggerController] Scheduled trigger skipped: no valid accounts');
            return;
        }

        for (const email of accounts) {
            const result = await triggerService.trigger(
                schedule.selectedModels,
                'auto',
                schedule.customPrompt,
                triggerSource,
                email,
                schedule.maxOutputTokens,
            );

            if (result.success) {
                logger.info(`[AutoTriggerController] Scheduled trigger executed successfully for ${email}`);
            } else {
                logger.error(`[AutoTriggerController] Scheduled trigger failed for ${email}: ${result.message}`);
            }
        }


        this.notifyStateUpdate();
    }

    /**
     *
     *
     *
     */
    async checkAndTriggerOnQuotaReset(): Promise<void> {
        logger.debug('[AutoTriggerController] checkAndTriggerOnQuotaReset called (multi-account)');

        const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
            enabled: false,
            repeatMode: 'daily',
            selectedModels: ['gemini-3-flash'],
            maxOutputTokens: 0,
        });

        logger.debug(`[AutoTriggerController] Schedule config: enabled=${schedule.enabled}, wakeOnReset=${schedule.wakeOnReset}, selectedAccounts=${JSON.stringify(schedule.selectedAccounts)}, selectedModels=${JSON.stringify(schedule.selectedModels)}`);

        if (!schedule.enabled) {
            logger.debug('[AutoTriggerController] Wake-up disabled, skipping');
            return;
        }

        if (!schedule.wakeOnReset) {
            logger.debug('[AutoTriggerController] Wake on reset is disabled, skipping');
            return;
        }

        if (schedule.timeWindowEnabled) {
            const inWindow = this.isInTimeWindow(schedule.timeWindowStart, schedule.timeWindowEnd);
            if (!inWindow) {
                logger.debug('[AutoTriggerController] Outside time window, quota reset trigger skipped (will use fallback times)');
                return;
            }
        }

        const accounts = await this.resolveScheduleAccounts(schedule);
        if (accounts.length === 0) {
            logger.debug('[AutoTriggerController] Wake on reset: No valid accounts, skipping');
            return;
        }

        const selectedModels = schedule.selectedModels || [];
        if (selectedModels.length === 0) {
            logger.debug('[AutoTriggerController] Wake on reset: No models selected, skipping');
            return;
        }

        logger.info(`[AutoTriggerController] Wake on reset: Checking ${accounts.length} accounts, ${selectedModels.length} models`);

        for (const email of accounts) {
            await this.checkAndTriggerForAccount(email, schedule, selectedModels);
        }
    }

    /**
     *
     * @param email
     * @param schedule
     * @param selectedModels
     */
    private async checkAndTriggerForAccount(
        email: string,
        schedule: ScheduleConfig,
        selectedModels: string[],
    ): Promise<void> {
        logger.debug(`[AutoTriggerController] Checking quota for account: ${email}`);

        try {
            const models = await this.fetchQuotaModelsForAccount(email);
            if (!models || models.length === 0) {
                logger.debug(`[AutoTriggerController] No quota data for ${email}, skipping`);
                return;
            }


            const quotaMap = new Map<string, { id: string; resetAt?: string; remaining: number; limit: number }>();
            for (const model of models) {
                if (!model.modelConstant) {
                    continue;
                }
                const resetAtMs = model.resetTime?.getTime();
                if (!resetAtMs || Number.isNaN(resetAtMs)) {
                    continue;
                }
                
                quotaMap.set(model.modelConstant, {
                    id: model.modelConstant,
                    resetAt: model.resetTime!.toISOString(),
                    remaining: model.remainingFraction !== undefined ? Math.floor(model.remainingFraction * 100) : 0,
                    limit: 100,
                });

                if (model.id) {
                    quotaMap.set(model.id, quotaMap.get(model.modelConstant)!);
                }
            }

            const modelsToTrigger: string[] = [];

            for (const modelId of selectedModels) {
                const modelConstant = this.modelIdToConstant.get(modelId);
                const triggerKey = `${email}:${modelConstant || modelId}`;

                const modelQuota = quotaMap.get(modelConstant || '') || quotaMap.get(modelId);
                if (!modelQuota) {
                    logger.debug(`[AutoTriggerController] Model ${modelId} not found in quota for ${email}`);
                    continue;
                }
                if (!modelQuota.resetAt) {
                    logger.debug(`[AutoTriggerController] Model ${modelId} has no resetAt for ${email}`);
                    continue;
                }

                logger.debug(`[AutoTriggerController] [${email}] Model ${modelId}: remaining=${modelQuota.remaining}%, resetAt=${modelQuota.resetAt}`);


                if (triggerService.shouldTriggerOnReset(triggerKey, modelQuota.resetAt, modelQuota.remaining, modelQuota.limit)) {
                    logger.debug(`[AutoTriggerController] [${email}] Model ${modelId} should trigger!`);
                    modelsToTrigger.push(modelId);
                    triggerService.markResetTriggered(triggerKey, modelQuota.resetAt);
                } else {
                    logger.debug(`[AutoTriggerController] [${email}] Model ${modelId} should NOT trigger`);
                }
            }

            if (modelsToTrigger.length === 0) {
                logger.debug(`[AutoTriggerController] [${email}] No models to trigger`);
                return;
            }

            logger.info(`[AutoTriggerController] Wake on reset: Triggering ${email} for models: ${modelsToTrigger.join(', ')}`);
            const result = await triggerService.trigger(
                modelsToTrigger,
                'auto',
                schedule.customPrompt,
                'quota_reset',
                email,
                schedule.maxOutputTokens,
            );

            if (result.success) {
                logger.info(`[AutoTriggerController] Wake on reset: Trigger successful for ${email}`);
            } else {
                logger.error(`[AutoTriggerController] Wake on reset: Trigger failed for ${email}: ${result.message}`);
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            logger.warn(`[AutoTriggerController] Failed to check quota for ${email}: ${error}`);
        }


        this.notifyStateUpdate();
    }

    /**
     *
     * @param email
     * @returns
     */
    private async fetchQuotaModelsForAccount(email: string): Promise<QuotaModelInfo[] | null> {
        try {

            const tokenResult = await oauthService.getAccessTokenStatusForAccount(email);
            if (tokenResult.state !== 'ok' || !tokenResult.token) {
                logger.debug(`[AutoTriggerController] Token unavailable for ${email}: ${tokenResult.state}`);
                return null;
            }


            const credential = await credentialStorage.getCredentialForAccount(email);
            const projectId = credential?.projectId;


            await triggerService.fetchAvailableModels(this.quotaModelConstants);
            


            const { cloudCodeClient } = await import('../shared/cloudcode_client');
            const quotaData = await cloudCodeClient.fetchAvailableModels(
                tokenResult.token,
                projectId,
                { logLabel: 'AutoTriggerController', timeoutMs: 30000 },
            );

            if (!quotaData?.models) {
                return null;
            }


            const result: QuotaModelInfo[] = [];
            for (const [id, info] of Object.entries(quotaData.models)) {
                const quotaInfo = (info as { quotaInfo?: { remainingFraction?: number; resetTime?: string } }).quotaInfo;
                const resetTimeStr = quotaInfo?.resetTime;
                const resetTime = resetTimeStr ? new Date(resetTimeStr) : undefined;
                const remainingFraction = quotaInfo?.remainingFraction;

                result.push({
                    id,
                    displayName: (info as { displayName?: string }).displayName || id,
                    modelConstant: (info as { model?: string }).model || '',
                    resetTime,
                    remainingFraction,
                });
            }

            logger.debug(`[AutoTriggerController] Fetched ${result.length} models for ${email}`);
            return result;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            logger.warn(`[AutoTriggerController] Failed to fetch quota models for ${email}: ${error}`);
            return null;
        }
    }

    /**
     *
     */
    describeSchedule(config: ScheduleConfig): string {
        return schedulerService.describeSchedule(config);
    }

    /**
     *
     */
    getPresets(): typeof SCHEDULE_PRESETS {
        return SCHEDULE_PRESETS;
    }

    /**
     *
     */
    configToCrontab(config: ScheduleConfig): string {
        return schedulerService.configToCrontab(config);
    }

    /**
     *
     */
    validateCrontab(crontab: string): { valid: boolean; description?: string; error?: string } {
        const result = CronParser.parse(crontab);
        return {
            valid: result.valid,
            description: result.description,
            error: result.error,
        };
    }

    /**
     *
     */
    getNextRunTimeFormatted(): string | null {
        const nextRun = schedulerService.getNextRunTime();
        if (!nextRun) {
            return null;
        }

        const now = new Date();
        const diff = nextRun.getTime() - now.getTime();

        if (diff < 0) {
            return null;
        }

        if (nextRun.toDateString() === now.toDateString()) {
            return nextRun.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        }


        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (nextRun.toDateString() === tomorrow.toDateString()) {
            return `${t('common.tomorrow')} ${nextRun.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
        }

        return nextRun.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    /**
     *
     */
    async handleMessage(message: AutoTriggerMessage): Promise<void> {
        switch (message.type) {
            case 'auto_trigger_get_state':
                this.notifyStateUpdate();
                break;

            case 'auto_trigger_start_auth':
                await this.startAuthorization();
                this.notifyStateUpdate();
                break;

            case 'auto_trigger_revoke_auth':
                await this.revokeAuthorization();
                this.notifyStateUpdate();
                break;

            case 'auto_trigger_save_schedule':
                try {
                    await this.saveSchedule(message.data as unknown as ScheduleConfig);
                    this.notifyStateUpdate();
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    vscode.window.showErrorMessage(err.message);
                }
                break;

            case 'auto_trigger_test_trigger':
                await this.testTrigger(
                    message.data?.models,
                    message.data?.accounts as string[] | undefined,
                    message.data?.maxOutputTokens as number | undefined,
                );
                break;

            default:
                logger.warn(`[AutoTriggerController] Unknown message type: ${message.type}`);
        }
    }

    /**
     *
     */
    setMessageHandler(handler: (message: AutoTriggerMessage) => void): void {
        this.messageHandler = handler;
    }

    /**
     *
     */
    private async notifyStateUpdate(): Promise<void> {
        this.updateStatusBar();

        if (this.messageHandler) {
            const state = await this.getState();
            this.messageHandler({
                type: 'auto_trigger_state_update',
                data: state as unknown as Record<string, unknown>,
            });
        }
    }

    /**
     *
     * @param startTime
     * @param endTime
     * @returns true
     */
    private isInTimeWindow(startTime?: string, endTime?: string): boolean {
        if (!startTime || !endTime) {
            return true;
        }

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        const parseTime = (timeStr: string): number => {
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };

        const startMinutes = parseTime(startTime);
        const endMinutes = parseTime(endTime);


        if (startMinutes <= endMinutes) {

            return currentMinutes >= startMinutes && currentMinutes < endMinutes;
        } else {

            return currentMinutes >= startMinutes || currentMinutes < endMinutes;
        }
    }

    /**
     *
     */
    private startFallbackScheduler(config: ScheduleConfig): void {
        this.stopFallbackScheduler();

        const fallbackTimes = config.fallbackTimes || [];
        if (fallbackTimes.length === 0) {
            return;
        }

        logger.info(`[AutoTriggerController] Starting fallback scheduler with times: ${fallbackTimes.join(', ')}`);

        const scheduleNextFallback = () => {
            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();

            const parseTime = (timeStr: string): number => {
                const [h, m] = timeStr.split(':').map(Number);
                return h * 60 + m;
            };

            const times = fallbackTimes.map(t => parseTime(t)).sort((a, b) => a - b);
            let nextTime = times.find(t => t > currentMinutes);

            const isNextDay = nextTime === undefined;
            if (isNextDay) {
                nextTime = times[0];
            }

            if (nextTime === undefined) {
                logger.warn('[AutoTriggerController] No fallback times available');
                return;
            }

            let delayMinutes = nextTime - currentMinutes;
            if (isNextDay) {
                delayMinutes += 24 * 60;
            }
            const delayMs = delayMinutes * 60 * 1000;

            logger.info(`[AutoTriggerController] Next fallback trigger in ${delayMinutes} minutes (${(nextTime / 60) | 0}:${String(nextTime % 60).padStart(2, '0')})`);

            const timer = setTimeout(async () => {
                if (config.timeWindowEnabled) {
                    const inWindow = this.isInTimeWindow(config.timeWindowStart, config.timeWindowEnd);
                    if (inWindow) {
                        logger.info('[AutoTriggerController] Fallback trigger skipped: now inside time window');
                        scheduleNextFallback();
                        return;
                    }
                }

                logger.info('[AutoTriggerController] Fallback trigger firing');
                await this.executeFallbackTrigger(config);
                scheduleNextFallback();
            }, delayMs);

            this.fallbackTimers.push(timer);
        };

        scheduleNextFallback();
    }

    /**
     *
     */
    private stopFallbackScheduler(): void {
        for (const timer of this.fallbackTimers) {
            clearTimeout(timer);
        }
        this.fallbackTimers = [];
        logger.debug('[AutoTriggerController] Fallback scheduler stopped');
    }

    /**
     *
     */
    private async executeFallbackTrigger(config: ScheduleConfig): Promise<void> {
        const accounts = await this.resolveAccountsFromList(config.selectedAccounts);
        if (accounts.length === 0) {
            logger.warn('[AutoTriggerController] Fallback trigger skipped: no valid accounts');
            return;
        }

        const selectedModels = config.selectedModels || ['gemini-3-flash'];
        for (const email of accounts) {
            const result = await triggerService.trigger(
                selectedModels,
                'auto',
                config.customPrompt,
                'scheduled',
                email,
                config.maxOutputTokens,
            );

            if (result.success) {
                logger.info(`[AutoTriggerController] Fallback trigger successful for ${email}`);
            } else {
                logger.error(`[AutoTriggerController] Fallback trigger failed for ${email}: ${result.message}`);
            }
        }

        this.notifyStateUpdate();
    }

    private resolveMaxOutputTokens(maxOutputTokens?: number): number {
        if (typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
            return Math.floor(maxOutputTokens);
        }
        const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
            enabled: false,
            repeatMode: 'daily',
            selectedModels: ['gemini-3-flash'],
            maxOutputTokens: 0,
        });
        // 0 means no limit, so return it directly
        return typeof schedule.maxOutputTokens === 'number' && schedule.maxOutputTokens >= 0
            ? Math.floor(schedule.maxOutputTokens)
            : 0;
    }

    /**
     *
     *
     * -
     * -
     * @returns
     */
    async syncToClientAccountOnStartup(): Promise<'switched' | 'same' | 'not_found' | 'not_exists'> {
        return this.withAccountLock(async () => {
            try {
                let currentEmail: string | null = null;
                const source = 'local' as const;
                
                const { previewLocalCredential } = await import('./local_auth_importer');
                

                try {
                    const preview = await previewLocalCredential();
                    if (preview?.email) {
                        currentEmail = preview.email;
                        logger.debug(`[AutoTriggerController] Startup sync: found local client account: ${currentEmail}`);
                    }
                } catch (localErr) {
                    logger.debug(`[AutoTriggerController] Startup sync: local client detection failed: ${localErr instanceof Error ? localErr.message : localErr}`);
                }
                
                if (!currentEmail) {
                    logger.debug('[AutoTriggerController] Startup sync: no local client account detected');
                    return 'not_found';
                }

                const activeEmail = await credentialStorage.getActiveAccount();
                const currentEmailLower = currentEmail.toLowerCase();
                
                if (activeEmail && activeEmail.toLowerCase() === currentEmailLower) {
                    logger.debug(`[AutoTriggerController] Startup sync: already using account ${activeEmail}`);
                    return 'same';
                }


                const accounts = await credentialStorage.getAllCredentials();
                const existingEmail = Object.keys(accounts).find(
                    email => email.toLowerCase() === currentEmailLower,
                );

                if (existingEmail) {
                    logger.info(`[AutoTriggerController] Startup sync: switching to existing account: ${existingEmail} (source: ${source})`);
                    await credentialStorage.setActiveAccount(existingEmail);
                    this.notifyStateUpdate();
                    return 'switched';
                } else {
                    logger.info(`[AutoTriggerController] Startup sync: account ${currentEmail} not found, importing silently...`);
                    try {
                        const { importLocalCredential } = await import('./local_auth_importer');
                        const result = await importLocalCredential();
                        if (result?.email) {
                            logger.info(`[AutoTriggerController] Startup sync: imported and switched to ${result.email}`);
                            this.notifyStateUpdate();
                            return 'switched';
                        }
                    } catch (importErr) {
                        logger.warn(`[AutoTriggerController] Startup sync: silent import failed: ${importErr instanceof Error ? importErr.message : importErr}`);
                    }
                    return 'not_exists';
                }
            } catch (error) {
                const err = error instanceof Error ? error.message : String(error);
                logger.warn(`[AutoTriggerController] Startup sync failed: ${err}`);
                return 'not_found';
            }
        });
    }

    /**
     *
     */
    dispose(): void {
        schedulerService.stop();
        this.stopFallbackScheduler();
        logger.info('[AutoTriggerController] Disposed');
    }
}

export const autoTriggerController = new AutoTriggerController();
