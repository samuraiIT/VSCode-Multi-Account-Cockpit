/**
 * Antigravity Cockpit -
 *
 */

import * as vscode from 'vscode';
import { CONFIG_KEYS, TIMING, LOG_LEVELS, STATUS_BAR_FORMAT, QUOTA_THRESHOLDS, DISPLAY_MODE } from './constants';
import { logger } from './log_service';
import {
    normalizeModelPreferenceState,
    type ModelPreferenceMigrationSummary,
} from './model_preference_migration';

export interface CockpitConfig {
    refreshInterval: number;
    showPromptCredits: boolean;
    pinnedModels: string[];
    modelOrder: string[];
    modelCustomNames: Record<string, string>;
    visibleModels: string[];
    logLevel: string;
    notificationEnabled: boolean;
    statusBarFormat: string;
    groupingEnabled: boolean;
    groupingCustomNames: Record<string, string>;
    groupingShowInStatusBar: boolean;
    pinnedGroups: string[];
    groupOrder: string[];
    groupMappings: Record<string, string>;
    warningThreshold: number;
    criticalThreshold: number;
    quotaSource: string;
    displayMode: string;
    profileHidden: boolean;
    dataMasked: boolean;
    language: string;
}

class ConfigService {
    private readonly configSection = 'agCockpit';
    private configChangeListeners: Array<(config: CockpitConfig) => void> = [];
    private globalState?: vscode.Memento;
    private initialized = false;
    private lastModelPreferenceMigrationSummary?: ModelPreferenceMigrationSummary;
    private readonly stateKeys = new Set<keyof CockpitConfig>([
        'groupMappings',
        'groupOrder',
        'modelCustomNames',
        'modelOrder',
        'pinnedModels',
        'pinnedGroups',
        'groupingCustomNames',
        'visibleModels',
        'quotaSource',
        'language',
    ]);
    private static readonly stateKeyPrefix = 'state';
    private static readonly migrationKey = `${ConfigService.stateKeyPrefix}.migratedToGlobalState.v171`;

    constructor() {
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(this.configSection)) {
                const newConfig = this.getConfig();
                this.configChangeListeners.forEach(listener => listener(newConfig));
            }
        });
    }

    /**
     *
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        this.globalState = context.globalState;
        this.initialized = true;
        await this.migrateSettingsToState();
        await this.migrateDeprecatedModelPreferences();
        await this.cleanupLegacySettings();
        await this.ensureAuthorizedQuotaSource();
    }

    private async ensureAuthorizedQuotaSource(): Promise<void> {
        if (!this.globalState) {
            return;
        }
        const stateKey = this.buildStateKey(CONFIG_KEYS.QUOTA_SOURCE);
        const current = this.globalState.get<string>(stateKey);
        if (current !== 'authorized') {
            logger.info(`[ConfigService] Forcing quota source to authorized (was: ${JSON.stringify(current)})`);
            await this.globalState.update(stateKey, 'authorized');
            this.notifyListeners();
        }
    }

    /**
     *
     */
    getConfig(): CockpitConfig {
        const config = vscode.workspace.getConfiguration(this.configSection);

        return {
            refreshInterval: config.get<number>(CONFIG_KEYS.REFRESH_INTERVAL, TIMING.DEFAULT_REFRESH_INTERVAL_MS / 1000),
            showPromptCredits: config.get<boolean>(CONFIG_KEYS.SHOW_PROMPT_CREDITS, false),
            pinnedModels: this.getConfigStateValue(CONFIG_KEYS.PINNED_MODELS, []),
            modelOrder: this.getConfigStateValue(CONFIG_KEYS.MODEL_ORDER, []),
            modelCustomNames: this.getConfigStateValue(CONFIG_KEYS.MODEL_CUSTOM_NAMES, {}),
            visibleModels: this.getConfigStateValue(CONFIG_KEYS.VISIBLE_MODELS, []),
            logLevel: config.get<string>(CONFIG_KEYS.LOG_LEVEL, LOG_LEVELS.INFO),
            notificationEnabled: config.get<boolean>(CONFIG_KEYS.NOTIFICATION_ENABLED, true),
            statusBarFormat: config.get<string>(CONFIG_KEYS.STATUS_BAR_FORMAT, STATUS_BAR_FORMAT.STANDARD),
            groupingEnabled: config.get<boolean>(CONFIG_KEYS.GROUPING_ENABLED, true),
            groupingCustomNames: this.getConfigStateValue(CONFIG_KEYS.GROUPING_CUSTOM_NAMES, {}),
            groupingShowInStatusBar: config.get<boolean>(CONFIG_KEYS.GROUPING_SHOW_IN_STATUS_BAR, true),
            pinnedGroups: this.getConfigStateValue(CONFIG_KEYS.PINNED_GROUPS, []),
            groupOrder: this.getConfigStateValue(CONFIG_KEYS.GROUP_ORDER, []),
            groupMappings: this.getConfigStateValue(CONFIG_KEYS.GROUP_MAPPINGS, {}),
            warningThreshold: config.get<number>(CONFIG_KEYS.WARNING_THRESHOLD, QUOTA_THRESHOLDS.WARNING_DEFAULT),
            criticalThreshold: config.get<number>(CONFIG_KEYS.CRITICAL_THRESHOLD, QUOTA_THRESHOLDS.CRITICAL_DEFAULT),
            quotaSource: 'authorized',
            displayMode: config.get<string>(CONFIG_KEYS.DISPLAY_MODE, DISPLAY_MODE.WEBVIEW),
            profileHidden: config.get<boolean>(CONFIG_KEYS.PROFILE_HIDDEN, false),
            dataMasked: config.get<boolean>(CONFIG_KEYS.DATA_MASKED, false),
            language: this.getConfigStateValue<string>(CONFIG_KEYS.LANGUAGE, 'auto'),
        };
    }

    /**
     *
     */
    getRefreshIntervalMs(): number {
        return this.getConfig().refreshInterval * 1000;
    }

    private buildStateKey(key: string): string {
        return `${ConfigService.stateKeyPrefix}.${key}`;
    }

    getStateFlag(key: string, fallback = false): boolean {
        if (!this.globalState) {
            return fallback;
        }
        return this.globalState.get<boolean>(this.buildStateKey(key), fallback);
    }

    async setStateFlag(key: string, value: boolean): Promise<void> {
        if (!this.globalState) {
            return;
        }
        await this.globalState.update(this.buildStateKey(key), value);
    }

    /**
     *
     */
    getStateValue<T>(key: string, fallbackValue?: T): T | undefined {
        if (this.globalState) {
            const stateKey = this.buildStateKey(key);
            const stored = this.globalState.get<T>(stateKey);
            if (stored !== undefined) {
                return stored;
            }
        }
        return fallbackValue;
    }

    /**
     *
     */
    async setStateValue<T>(key: string, value: T): Promise<void> {
        if (!this.globalState) {
            return;
        }
        const stateKey = this.buildStateKey(key);
        await this.globalState.update(stateKey, value);
    }

    private getConfigStateValue<T>(configKey: string, fallbackValue: T): T {
        if (this.globalState) {
            const stateKey = this.buildStateKey(configKey);
            const stored = this.globalState.get<T>(stateKey);
            if (stored !== undefined) {
                if (configKey === CONFIG_KEYS.QUOTA_SOURCE) {
                    logger.debug(`[ConfigService] getStateValue: ${configKey} = ${JSON.stringify(stored)} (from globalState)`);
                }
                return stored;
            }
        }
        const config = vscode.workspace.getConfiguration(this.configSection);
        const fallback = config.get<T>(configKey as keyof CockpitConfig, fallbackValue);
        if (configKey === CONFIG_KEYS.QUOTA_SOURCE) {
            logger.debug(`[ConfigService] getStateValue: ${configKey} = ${JSON.stringify(fallback)} (from config fallback)`);
        }
        return fallback;
    }

    private isStateKey(key: keyof CockpitConfig): boolean {
        return this.stateKeys.has(key);
    }

    private notifyListeners(): void {
        const newConfig = this.getConfig();
        this.configChangeListeners.forEach(listener => listener(newConfig));
    }

    getLastModelPreferenceMigrationSummary(): ModelPreferenceMigrationSummary | undefined {
        return this.lastModelPreferenceMigrationSummary;
    }

    /**
     *
     */
    async updateConfig<K extends keyof CockpitConfig>(
        key: K, 
        value: CockpitConfig[K], 
        target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
    ): Promise<void> {
        const normalizedValue = this.normalizeModelPreferenceConfigValue(
            key,
            (key === 'quotaSource' ? 'authorized' : value) as CockpitConfig[K],
        );
        if (this.isStateKey(key) && this.globalState) {
            const stateKey = this.buildStateKey(key);
            logger.info(`Updating state '${stateKey}':`, JSON.stringify(normalizedValue));
            await this.globalState.update(stateKey, normalizedValue);
            this.notifyListeners();
            return;
        }

        logger.info(`Updating config '${this.configSection}.${key}':`, JSON.stringify(normalizedValue));
        const config = vscode.workspace.getConfiguration(this.configSection);
        await config.update(key, normalizedValue, target);
    }

    private normalizeModelPreferenceConfigValue<K extends keyof CockpitConfig>(
        key: K,
        value: CockpitConfig[K],
    ): CockpitConfig[K] {
        switch (key) {
            case 'visibleModels': {
                const { normalized, summary } = normalizeModelPreferenceState({ visibleModels: value as string[] });
                this.logInlineModelPreferenceNormalization('visibleModels', summary);
                return normalized.visibleModels as CockpitConfig[K];
            }
            case 'pinnedModels': {
                const { normalized, summary } = normalizeModelPreferenceState({ pinnedModels: value as string[] });
                this.logInlineModelPreferenceNormalization('pinnedModels', summary);
                return normalized.pinnedModels as CockpitConfig[K];
            }
            case 'modelOrder': {
                const { normalized, summary } = normalizeModelPreferenceState({ modelOrder: value as string[] });
                this.logInlineModelPreferenceNormalization('modelOrder', summary);
                return normalized.modelOrder as CockpitConfig[K];
            }
            case 'modelCustomNames': {
                const { normalized, summary } = normalizeModelPreferenceState({
                    modelCustomNames: value as Record<string, string>,
                });
                this.logInlineModelPreferenceNormalization('modelCustomNames', summary);
                return normalized.modelCustomNames as CockpitConfig[K];
            }
            case 'groupingCustomNames': {
                const { normalized, summary } = normalizeModelPreferenceState({
                    groupingCustomNames: value as Record<string, string>,
                });
                this.logInlineModelPreferenceNormalization('groupingCustomNames', summary);
                return normalized.groupingCustomNames as CockpitConfig[K];
            }
            case 'groupMappings': {
                const { normalized, summary } = normalizeModelPreferenceState({
                    groupMappings: value as Record<string, string>,
                });
                this.logInlineModelPreferenceNormalization('groupMappings', summary);
                return normalized.groupMappings as CockpitConfig[K];
            }
            default:
                return value;
        }
    }

    private logInlineModelPreferenceNormalization(
        field: string,
        summary: ModelPreferenceMigrationSummary,
    ): void {
        if (!summary.changed) {
            return;
        }
        logger.info(
            `[ConfigService] Canonicalized deprecated model references in ${field}`,
            summary.replacementCounts,
        );
    }

    /**
     *
     */
    async togglePinnedModel(modelId: string): Promise<string[]> {
        logger.info(`Toggling pin state for model: ${modelId}`);
        const config = this.getConfig();
        const pinnedModels = [...config.pinnedModels];

        const existingIndex = pinnedModels.findIndex(
            p => p.toLowerCase() === modelId.toLowerCase(),
        );

        if (existingIndex > -1) {
            logger.info(`Model ${modelId} found at index ${existingIndex}, removing.`);
            pinnedModels.splice(existingIndex, 1);
        } else {
            logger.info(`Model ${modelId} not found, adding.`);
            pinnedModels.push(modelId);
        }

        logger.info(`New pinned models: ${JSON.stringify(pinnedModels)}`);
        await this.updateConfig('pinnedModels', pinnedModels);
        return pinnedModels;
    }

    /**
     *
     */
    async toggleShowPromptCredits(): Promise<boolean> {
        const config = this.getConfig();
        const newValue = !config.showPromptCredits;
        await this.updateConfig('showPromptCredits', newValue);
        return newValue;
    }

    /**
     *
     */
    async updateModelOrder(order: string[]): Promise<void> {
        await this.updateConfig('modelOrder', order);
    }

    /**
     *
     */
    async updateVisibleModels(modelIds: string[]): Promise<void> {
        await this.updateConfig('visibleModels', modelIds);
        await this.setStateFlag('visibleModelsInitialized', true);
    }

    /**
     *
     */
    async resetModelOrder(): Promise<void> {
        await this.updateConfig('modelOrder', []);
    }

    /**
     *
     * @param modelId
     * @param displayName
     */
    async updateModelName(modelId: string, displayName: string): Promise<void> {
        const config = this.getConfig();
        const customNames = { ...config.modelCustomNames };
        
        if (displayName.trim()) {
            customNames[modelId] = displayName.trim();
        } else {
            delete customNames[modelId];
        }
        
        logger.info(`Updating model name for ${modelId} to: ${displayName}`);
        await this.updateConfig('modelCustomNames', customNames);
    }

    /**
     *
     *
     * @param modelIds
     * @param groupName
     */
    async updateGroupName(modelIds: string[], groupName: string): Promise<void> {
        const config = this.getConfig();
        const customNames = { ...config.groupingCustomNames };
        

        for (const modelId of modelIds) {
            customNames[modelId] = groupName;
        }
        
        logger.info(`Updating group name for ${modelIds.length} models to: ${groupName}`);
        await this.updateConfig('groupingCustomNames', customNames);
    }

    /**
     *
     */
    async toggleGroupingEnabled(): Promise<boolean> {
        const config = this.getConfig();
        const newValue = !config.groupingEnabled;
        await this.updateConfig('groupingEnabled', newValue);
        return newValue;
    }

    /**
     *
     */
    async toggleGroupingStatusBar(): Promise<boolean> {
        const config = this.getConfig();
        const newValue = !config.groupingShowInStatusBar;
        await this.updateConfig('groupingShowInStatusBar', newValue);
        return newValue;
    }

    /**
     *
     */
    async togglePinnedGroup(groupId: string): Promise<string[]> {
        logger.info(`Toggling pin state for group: ${groupId}`);
        const config = this.getConfig();
        const pinnedGroups = [...config.pinnedGroups];

        const existingIndex = pinnedGroups.indexOf(groupId);

        if (existingIndex > -1) {
            logger.info(`Group ${groupId} found at index ${existingIndex}, removing.`);
            pinnedGroups.splice(existingIndex, 1);
        } else {
            logger.info(`Group ${groupId} not found, adding.`);
            pinnedGroups.push(groupId);
        }

        logger.info(`New pinned groups: ${JSON.stringify(pinnedGroups)}`);
        await this.updateConfig('pinnedGroups', pinnedGroups);
        return pinnedGroups;
    }

    /**
     *
     */
    async updateGroupOrder(order: string[]): Promise<void> {
        await this.updateConfig('groupOrder', order);
    }

    /**
     *
     */
    async resetGroupOrder(): Promise<void> {
        await this.updateConfig('groupOrder', []);
    }

    /**
     *
     */
    async updateGroupMappings(mappings: Record<string, string>): Promise<void> {
        await this.updateConfig('groupMappings', mappings);
    }

    /**
     *
     */
    async clearGroupMappings(): Promise<void> {
        await this.updateConfig('groupMappings', {});
    }

    /**
     *
     */
    onConfigChange(listener: (config: CockpitConfig) => void): vscode.Disposable {
        this.configChangeListeners.push(listener);
        return {
            dispose: () => {
                const index = this.configChangeListeners.indexOf(listener);
                if (index > -1) {
                    this.configChangeListeners.splice(index, 1);
                }
            },
        };
    }

    /**
     *
     */
    isModelPinned(modelId: string): boolean {
        return this.getConfig().pinnedModels.some(
            p => p.toLowerCase() === modelId.toLowerCase(),
        );
    }

    private async migrateSettingsToState(): Promise<void> {
        if (!this.globalState || this.globalState.get<boolean>(ConfigService.migrationKey, false)) {
            return;
        }

        const config = vscode.workspace.getConfiguration(this.configSection);
        const migrations: Array<{
            key: keyof CockpitConfig;
            configKey: string;
            defaultValue: unknown;
        }> = [
            { key: 'groupMappings', configKey: CONFIG_KEYS.GROUP_MAPPINGS, defaultValue: {} },
            { key: 'groupOrder', configKey: CONFIG_KEYS.GROUP_ORDER, defaultValue: [] },
            { key: 'modelCustomNames', configKey: CONFIG_KEYS.MODEL_CUSTOM_NAMES, defaultValue: {} },
            { key: 'modelOrder', configKey: CONFIG_KEYS.MODEL_ORDER, defaultValue: [] },
            { key: 'pinnedModels', configKey: CONFIG_KEYS.PINNED_MODELS, defaultValue: [] },
            { key: 'pinnedGroups', configKey: CONFIG_KEYS.PINNED_GROUPS, defaultValue: [] },
            { key: 'groupingCustomNames', configKey: CONFIG_KEYS.GROUPING_CUSTOM_NAMES, defaultValue: {} },
            { key: 'visibleModels', configKey: CONFIG_KEYS.VISIBLE_MODELS, defaultValue: [] },
            { key: 'quotaSource', configKey: CONFIG_KEYS.QUOTA_SOURCE, defaultValue: 'authorized' },
        ];

        let migrated = false;
        for (const item of migrations) {
            const value = config.get(item.configKey as keyof CockpitConfig, item.defaultValue as unknown);
            const hasValue = Array.isArray(value)
                ? value.length > 0
                : value && typeof value === 'object'
                    ? Object.keys(value).length > 0
                    : value !== item.defaultValue;
            if (hasValue) {
                const stateKey = this.buildStateKey(item.configKey);
                await this.globalState.update(stateKey, value);
                migrated = true;
            }
            await this.clearSetting(item.configKey);
        }

        await this.globalState.update(ConfigService.migrationKey, true);
        if (migrated) {
            this.notifyListeners();
        }
    }

    private async cleanupLegacySettings(): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.configSection);
        const keysToClear = [
            CONFIG_KEYS.GROUP_MAPPINGS,
            CONFIG_KEYS.GROUP_ORDER,
            CONFIG_KEYS.MODEL_CUSTOM_NAMES,
            CONFIG_KEYS.MODEL_ORDER,
            CONFIG_KEYS.PINNED_MODELS,
            CONFIG_KEYS.PINNED_GROUPS,
            CONFIG_KEYS.GROUPING_CUSTOM_NAMES,
            CONFIG_KEYS.VISIBLE_MODELS,
            CONFIG_KEYS.QUOTA_SOURCE,
            'viewMode',
            'dashboardViewMode',
            'cardStyle',
            'announcementCacheTTL',
        ];

        for (const key of keysToClear) {
            const inspected = config.inspect(key);
            const hasValue = inspected?.globalValue !== undefined || inspected?.workspaceValue !== undefined;
            if (hasValue) {
                await this.clearSetting(key);
            }
        }
    }

    private async migrateDeprecatedModelPreferences(): Promise<void> {
        if (!this.globalState) {
            return;
        }

        const current = {
            visibleModels: this.getConfigStateValue(CONFIG_KEYS.VISIBLE_MODELS, []),
            pinnedModels: this.getConfigStateValue(CONFIG_KEYS.PINNED_MODELS, []),
            modelOrder: this.getConfigStateValue(CONFIG_KEYS.MODEL_ORDER, []),
            modelCustomNames: this.getConfigStateValue(CONFIG_KEYS.MODEL_CUSTOM_NAMES, {}),
            groupingCustomNames: this.getConfigStateValue(CONFIG_KEYS.GROUPING_CUSTOM_NAMES, {}),
            groupMappings: this.getConfigStateValue(CONFIG_KEYS.GROUP_MAPPINGS, {}),
        };

        const { normalized, summary } = normalizeModelPreferenceState(current);
        this.lastModelPreferenceMigrationSummary = summary.changed ? summary : undefined;
        if (!summary.changed) {
            return;
        }

        logger.info(
            `[ConfigService] Migrated deprecated model preferences: fields=${summary.changedFields.join(', ')}`,
            summary.replacementCounts,
        );

        await this.globalState.update(this.buildStateKey(CONFIG_KEYS.VISIBLE_MODELS), normalized.visibleModels ?? []);
        await this.globalState.update(this.buildStateKey(CONFIG_KEYS.PINNED_MODELS), normalized.pinnedModels ?? []);
        await this.globalState.update(this.buildStateKey(CONFIG_KEYS.MODEL_ORDER), normalized.modelOrder ?? []);
        await this.globalState.update(this.buildStateKey(CONFIG_KEYS.MODEL_CUSTOM_NAMES), normalized.modelCustomNames ?? {});
        await this.globalState.update(this.buildStateKey(CONFIG_KEYS.GROUPING_CUSTOM_NAMES), normalized.groupingCustomNames ?? {});
        await this.globalState.update(this.buildStateKey(CONFIG_KEYS.GROUP_MAPPINGS), normalized.groupMappings ?? {});
    }

    private async clearSetting(configKey: string): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.configSection);
        await config.update(configKey, undefined, vscode.ConfigurationTarget.Global);
        try {
            await config.update(configKey, undefined, vscode.ConfigurationTarget.Workspace);
        } catch {
            // Ignore workspace removal errors when no workspace is open.
        }
    }
}

export const configService = new ConfigService();
