
import * as vscode from 'vscode';
import { CockpitHUD } from '../view/hud';
import { ReactorCore } from '../engine/reactor';
import { configService } from '../shared/config_service';
import { logger } from '../shared/log_service';
import { t, i18n, normalizeLocaleInput } from '../shared/i18n';
import { WebviewMessage } from '../shared/types';
import { TIMING } from '../shared/constants';
import { autoTriggerController } from '../auto_trigger/controller';
import { credentialStorage } from '../auto_trigger';
import { previewLocalCredential, commitLocalCredential } from '../auto_trigger/local_auth_importer';
import { announcementService } from '../announcement';
import { antigravityToolsSyncService } from '../antigravityTools_sync';
import { cockpitToolsWs } from '../services/cockpitToolsWs';
import { getQuotaHistory, clearHistory, clearAllHistory } from '../services/quota_history';
import { oauthService } from '../auto_trigger';
import { AccountsRefreshService } from '../services/accountsRefreshService';
import { accountSwitchService, AccountSwitchMode, AccountSwitchModeInput, AccountSwitchResult } from '../services/accountSwitchService';
import { openCockpitToolsDesktop } from '../shared/cockpit_tools_launcher';
import { readAllCockpitAccounts } from '../services/cockpitToolsAllAccounts';

export interface AccountSwitchExecutionRequest {
    requestId?: string;
    targetEmail: string;
    switchMode?: AccountSwitchModeInput;
    triggerType?: 'manual' | 'auto';
    triggerSource?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
}

export interface AccountSwitchExecutionResult {
    executionId: string;
    requestId?: string;
    success: boolean;
    effectiveMode: AccountSwitchMode;
    fromEmail: string | null;
    toEmail: string;
    durationMs: number;
    errorCode: string | null;
    errorMessage: string | null;
    finishedAt: string;
}

export class MessageController {

    private context: vscode.ExtensionContext;
    
    private importCancelToken: { cancelled: boolean } | null = null;

    constructor(
        context: vscode.ExtensionContext,
        private hud: CockpitHUD,
        private reactor: ReactorCore,
        private onRetry: () => Promise<void>,
        private refreshService?: AccountsRefreshService,
    ) {
        this.context = context;
        this.setupMessageHandling();
    }

    private async applyQuotaSourceChange(
        source: 'local' | 'authorized',
    ): Promise<void> {
        const requestedSource = source;
        source = 'authorized';
        const previousSource = configService.getConfig().quotaSource;

        this.reactor.cancelInitRetry();

        if (requestedSource !== 'authorized') {
            logger.info(`Quota source switch request ignored (${requestedSource}), forcing authorized mode`);
        }
        logger.info(`User changed quota source: ${previousSource} -> ${source}`);
        await configService.updateConfig('quotaSource', source);
        const savedSource = configService.getConfig().quotaSource;
        logger.info(`QuotaSource saved: requested=${source}, actual=${savedSource}`);


        this.hud.sendMessage({
            type: 'quotaSourceLoading',
            data: { source },
        });
        this.hud.sendMessage({
            type: 'switchTab',
            tab: 'quota',
        });

        if (previousSource !== source) {
            this.reactor.syncTelemetry();
            return;
        }

        const cacheAge = this.reactor.getCacheAgeMs(source);
        const refreshIntervalMs = configService.getConfig().refreshInterval ?? TIMING.DEFAULT_REFRESH_INTERVAL_MS;
        const hasCache = this.reactor.publishCachedTelemetry(source);
        const cacheStale = cacheAge === undefined || cacheAge > refreshIntervalMs;
        if (!hasCache || cacheStale) {
            this.reactor.syncTelemetry();
        }
    }

    private async switchLoginAccountByMode(
        email: string,
        requestedMode: AccountSwitchModeInput = 'auto',
    ): Promise<AccountSwitchResult> {
        const targetEmail = email.trim();
        const effectiveMode = accountSwitchService.resolveRequestedMode(requestedMode);
        try {
            const result = await accountSwitchService.switchAccount(targetEmail, { requestedMode });
            if (!result.success) {
                logger.warn(
                    `[MsgCtrl] Account switch failed: target=${targetEmail}, mode=${result.mode}, code=${result.errorCode ?? 'none'}, message=${result.message ?? 'none'}`,
                );
                return result;
            }

            if (this.refreshService) {
                await this.refreshService.refresh({
                    skipSync: true,
                    skipQuotaRefresh: true,
                    reason: requestedMode === 'auto' ? 'manualAccountSwitch' : `manualAccountSwitch:${requestedMode}`,
                });
            }
            this.reactor.syncTelemetry();
            logger.info(
                `[MsgCtrl] Account switch succeeded: target=${targetEmail}, resolved=${result.email ?? targetEmail}, mode=${result.mode}`,
            );
            return result;
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            logger.error(`[MsgCtrl] Account switch exception for ${targetEmail}: ${err}`);
            return {
                success: false,
                mode: effectiveMode,
                email: targetEmail,
                errorCode: 'unknown',
                message: err,
            };
        }
    }

    private createSwitchExecutionId(): string {
        return `switch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    public async executeAccountSwitch(request: AccountSwitchExecutionRequest): Promise<AccountSwitchExecutionResult> {
        const startedAt = Date.now();
        const executionId = this.createSwitchExecutionId();
        const requestId = typeof request.requestId === 'string' ? request.requestId : undefined;
        const targetEmail = (request.targetEmail || '').trim();
        const requestedMode = request.switchMode ?? 'auto';
        const triggerType = request.triggerType === 'auto' ? 'auto' : 'manual';
        const triggerSource = request.triggerSource || 'unknown';
        const reason = request.reason || '';
        const metadata = request.metadata;
        const fromEmail = await credentialStorage.getActiveAccount();

        if (!targetEmail) {
            const finishedAt = new Date().toISOString();
            return {
                executionId,
                requestId,
                success: false,
                effectiveMode: accountSwitchService.resolveRequestedMode(requestedMode),
                fromEmail: fromEmail ?? null,
                toEmail: '',
                durationMs: Date.now() - startedAt,
                errorCode: 'invalid_request',
                errorMessage: 'targetEmail cannot be empty',
                finishedAt,
            };
        }

        logger.info(
            `[MsgCtrl] Switch execution start: executionId=${executionId}, requestId=${requestId ?? 'none'}, target=${targetEmail}, requestedMode=${requestedMode}, triggerType=${triggerType}, triggerSource=${triggerSource}, reason=${reason || 'none'}, metadata=${metadata ? JSON.stringify(metadata) : 'none'}`,
        );

        const result = await this.switchLoginAccountByMode(targetEmail, requestedMode);
        const finishedAt = new Date().toISOString();
        const toEmail = (result.email ?? targetEmail).trim();
        const durationMs = Date.now() - startedAt;
        const success = result.success;
        const errorCode = success ? null : (result.errorCode ?? 'unknown');
        const errorMessage = success ? null : (result.message ?? null);

        logger.info(
            `[MsgCtrl] Switch execution done: executionId=${executionId}, success=${success}, effectiveMode=${result.mode}, from=${fromEmail ?? 'none'}, to=${toEmail}, durationMs=${durationMs}, errorCode=${errorCode ?? 'none'}`,
        );

        return {
            executionId,
            requestId,
            success,
            effectiveMode: result.mode,
            fromEmail: fromEmail ?? null,
            toEmail,
            durationMs,
            errorCode,
            errorMessage,
            finishedAt,
        };
    }

    /**
     *
     * 1.
     * 2.
     */
    private async showToolsNotRunningActions(): Promise<void> {
        const launchAction = t('accountTree.launchCockpitTools');
        const downloadAction = t('accountTree.downloadCockpitTools');
        const action = await vscode.window.showWarningMessage(
            t('accountTree.cockpitToolsNotRunning'),
            launchAction,
            downloadAction,
        );
        if (action === launchAction) {
            vscode.commands.executeCommand('agCockpit.accountTree.openManager');
        } else if (action === downloadAction) {
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/jlcodes99/antigravity-cockpit-tools/releases'));
        }
    }

    private setupMessageHandling(): void {

        autoTriggerController.setMessageHandler((message) => {
            if (message.type === 'auto_trigger_state_update') {
                this.hud.sendMessage({
                    type: 'autoTriggerState',
                    data: message.data,
                });
            }
        });

        this.hud.onSignal(async (msg: WebviewMessage) => {
            const message = msg;
            switch (message.command) {
                case 'togglePin':
                    logger.info(`Received togglePin signal: ${JSON.stringify(message)}`);
                    if (message.modelId) {
                        await configService.togglePinnedModel(message.modelId);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('togglePin signal missing modelId');
                    }
                    break;

                case 'toggleCredits':
                    logger.info('User toggled Prompt Credits display');
                    await configService.toggleShowPromptCredits();
                    this.reactor.reprocess();
                    break;

                case 'updateOrder':
                    if (message.order) {
                        logger.info(`User updated model order. Count: ${message.order.length}`);
                        await configService.updateModelOrder(message.order);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('updateOrder signal missing order data');
                    }
                    break;

                case 'updateVisibleModels':
                    if (Array.isArray(message.visibleModels)) {
                        logger.info(`User updated visible models. Count: ${message.visibleModels.length}`);
                        await configService.updateVisibleModels(message.visibleModels);
                        if (configService.getConfig().quotaSource === 'authorized') {
                            await configService.setStateFlag('visibleModelsInitializedAuthorized', true);
                        }
                        this.reactor.reprocess();
                    } else {
                        logger.warn('updateVisibleModels signal missing visibleModels');
                    }
                    break;

                case 'resetOrder': {
                    const currentConfig = configService.getConfig();
                    if (currentConfig.groupingEnabled) {
                        logger.info('User reset group order to default');
                        await configService.resetGroupOrder();
                    } else {
                        logger.info('User reset model order to default');
                        await configService.resetModelOrder();
                    }
                    this.reactor.reprocess();
                    break;
                }

                case 'refresh':
                    logger.info('User triggered manual refresh');

                    cockpitToolsWs.ensureConnected();

                    {
                        const config = configService.getConfig();
                        let handled = false;

                        if (config.quotaSource === 'authorized' && this.refreshService) {
                            const activeEmail = await credentialStorage.getActiveAccount();
                            if (activeEmail) {
                                logger.info(`[MsgCtrl] Refreshing active account: ${activeEmail}`);

                                await this.refreshService.loadAccountQuota(activeEmail);
                                handled = true;
                            }
                        }

                        if (!handled && this.refreshService) {
                            this.refreshService.refresh();
                        }
                        await this.reactor.syncTelemetry();

                        const state = await autoTriggerController.getState();
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                    }
                    break;

                case 'init':
                    if (this.reactor.hasCache) {
                        logger.info('Dashboard initialized (reprocessing cached data)');
                        this.reactor.reprocess();
                    } else {
                        logger.info('Dashboard initialized (no cache, performing full sync)');
                        this.reactor.syncTelemetry();
                    }
                    if (this.refreshService) {

                    }
                    {
                        const annState = await announcementService.getState();
                        this.hud.sendMessage({
                            type: 'announcementState',
                            data: annState,
                        });
                    }

                    break;

                case 'retry':
                    logger.info('User triggered connection retry');
                    await this.onRetry();
                    break;

                case 'openLogs':
                    logger.info('User opened logs');
                    logger.show();
                    break;

                case 'rerender':
                    logger.info('Dashboard requested re-render');
                    this.reactor.reprocess();
                    break;

                case 'toggleGrouping': {
                    logger.info('User toggled grouping display');
                    const enabled = await configService.toggleGroupingEnabled();
                    if (enabled) {
                        const config = configService.getConfig();
                        if (!config.groupingShowInStatusBar) {
                            await configService.updateConfig('groupingShowInStatusBar', true);
                        }


                        if (Object.keys(config.groupMappings).length === 0) {
                            const latestSnapshot = this.reactor.getLatestSnapshot();
                            if (latestSnapshot && latestSnapshot.models.length > 0) {
                                const autoGrouping = ReactorCore.calculateSmartGrouping(latestSnapshot.models);
                                if (Object.keys(autoGrouping.groupMappings).length > 0) {
                                    await configService.updateGroupMappings(autoGrouping.groupMappings);
                                    await configService.updateConfig('groupingCustomNames', autoGrouping.groupNames);
                                    logger.info(`First-time grouping: auto-grouped ${Object.keys(autoGrouping.groupMappings).length} models`);
                                } else {
                                    logger.debug('First-time grouping skipped: no models matched smart-group families');
                                }
                            }
                        }
                    }
                    this.reactor.reprocess();
                    break;
                }

                case 'renameGroup':
                    if (message.modelIds && message.groupName) {
                        logger.info(`User renamed group to: ${message.groupName}`);
                        await configService.updateGroupName(message.modelIds, message.groupName);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('renameGroup signal missing required data');
                    }
                    break;

                case 'promptRenameGroup':
                    if (message.modelIds && message.currentName) {
                        const newName = await vscode.window.showInputBox({
                            prompt: t('grouping.renamePrompt'),
                            value: message.currentName,
                            placeHolder: t('grouping.rename'),
                        });
                        if (newName && newName.trim() && newName !== message.currentName) {
                            logger.info(`User renamed group to: ${newName}`);
                            await configService.updateGroupName(message.modelIds, newName.trim());
                            this.reactor.reprocess();
                        }
                    } else {
                        logger.warn('promptRenameGroup signal missing required data');
                    }
                    break;

                case 'toggleGroupPin':
                    if (message.groupId) {
                        logger.info(`Toggling group pin: ${message.groupId}`);
                        await configService.togglePinnedGroup(message.groupId);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('toggleGroupPin signal missing groupId');
                    }
                    break;

                case 'updateGroupOrder':
                    if (message.order) {
                        logger.info(`User updated group order. Count: ${message.order.length}`);
                        await configService.updateGroupOrder(message.order);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('updateGroupOrder signal missing order data');
                    }
                    break;

                case 'autoGroup': {
                    logger.info('User triggered auto-grouping');
                    const latestSnapshot = this.reactor.getLatestSnapshot();
                    if (latestSnapshot && latestSnapshot.models.length > 0) {

                        const autoGrouping = ReactorCore.calculateSmartGrouping(latestSnapshot.models);
                        await configService.updateGroupMappings(autoGrouping.groupMappings);
                        await configService.updateConfig('groupingCustomNames', autoGrouping.groupNames);
                        logger.info(`Auto-grouped ${Object.keys(autoGrouping.groupMappings).length} models`);


                        await configService.updateConfig('pinnedGroups', []);


                        this.reactor.reprocess();
                    } else {
                        logger.warn('No snapshot data available for auto-grouping');
                    }
                    break;
                }

                case 'updateNotificationEnabled':
                    if (message.notificationEnabled !== undefined) {
                        const enabled = message.notificationEnabled as boolean;
                        await configService.updateConfig('notificationEnabled', enabled);
                        logger.info(`Notification enabled: ${enabled}`);
                        vscode.window.showInformationMessage(
                            enabled ? t('notification.enabled') : t('notification.disabled'),
                        );
                    }
                    break;

                case 'updateThresholds':
                    if (message.warningThreshold !== undefined && message.criticalThreshold !== undefined) {
                        const warningVal = message.warningThreshold as number;
                        const criticalVal = message.criticalThreshold as number;

                        if (criticalVal < warningVal && warningVal >= 5 && warningVal <= 80 && criticalVal >= 1 && criticalVal <= 50) {
                            await configService.updateConfig('warningThreshold', warningVal);
                            await configService.updateConfig('criticalThreshold', criticalVal);


                            const summaryText = `Warning: ${warningVal}%, Critical: ${criticalVal}`;

                            logger.info(
                                `Thresholds updated: warning=${warningVal}%, critical=${criticalVal}%`,
                            );
                            vscode.window.showInformationMessage(
                                t('threshold.updated', { value: summaryText }),
                            );







                            this.reactor.reprocess();
                        } else {
                            logger.warn('Invalid threshold values received from dashboard');
                        }
                    }
                    break;

                case 'renameModel':
                    if (message.modelId && message.groupName !== undefined) {
                        logger.info(`User renamed model ${message.modelId} to: ${message.groupName}`);
                        await configService.updateModelName(message.modelId, message.groupName);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('renameModel signal missing required data');
                    }
                    break;

                case 'updateStatusBarFormat':
                    if (message.statusBarFormat) {
                        logger.info(`User changed status bar format to: ${message.statusBarFormat}`);
                        await configService.updateConfig('statusBarFormat', message.statusBarFormat);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('updateStatusBarFormat signal missing statusBarFormat');
                    }
                    break;

                case 'toggleProfile':
                    logger.info('User toggled profile visibility');
                    {
                        const currentConfig = configService.getConfig();
                        await configService.updateConfig('profileHidden', !currentConfig.profileHidden);
                        this.reactor.reprocess();
                    }
                    break;

                case 'updateDisplayMode':
                    if (message.displayMode) {
                        logger.info(`User changed display mode to: ${message.displayMode}`);
                        await configService.updateConfig('displayMode', message.displayMode);

                        if (message.displayMode === 'quickpick') {

                            this.hud.dispose();

                            this.reactor.reprocess();

                            vscode.commands.executeCommand('agCockpit.open');
                        } else {
                            this.reactor.reprocess();
                        }
                    }
                    break;

                case 'updateQuotaSource':
                    if (message.quotaSource) {
                        await this.applyQuotaSourceChange(message.quotaSource);
                    } else {
                        logger.warn('updateQuotaSource signal missing quotaSource');
                    }
                    break;



                case 'updateDataMasked':
                    if (message.dataMasked !== undefined) {
                        logger.info(`User changed data masking to: ${message.dataMasked}`);
                        await configService.updateConfig('dataMasked', message.dataMasked);
                        this.reactor.reprocess();
                    }
                    break;

                case 'antigravityToolsSync.import':
                    await this.handleAntigravityToolsImport(false);
                    break;

                case 'antigravityToolsSync.importAuto':
                    await this.handleAntigravityToolsImport(true);
                    break;

                case 'antigravityToolsSync.importConfirm':
                    {
                        const activeEmail = await credentialStorage.getActiveAccount();
                        const importOnly = message.importOnly === true;
                        const switchOnly = message.switchOnly === true;
                        const targetEmail = message.targetEmail as string | undefined;

                        if (switchOnly && targetEmail) {
                            await antigravityToolsSyncService.switchOnly(targetEmail);
                            const state = await autoTriggerController.getState();
                            this.hud.sendMessage({ type: 'autoTriggerState', data: state });
                            this.hud.sendMessage({ type: 'antigravityToolsSyncComplete', data: { success: true } });

                            if (configService.getConfig().quotaSource === 'authorized') {
                                const usedCache = await this.reactor.tryUseQuotaCache('authorized', targetEmail);
                                if (!usedCache) {
                                    this.reactor.syncTelemetry();
                                }
                            }
                            vscode.window.showInformationMessage(
                                t('autoTrigger.accountSwitched', { email: targetEmail }) 
                                || `Switched to account: ${targetEmail}`,
                            );
                        } else {
                            await this.performAntigravityToolsImport(activeEmail, false, importOnly);
                        }
                    }
                    break;

                case 'antigravityToolsSync.importJson':
                    if (typeof message.jsonText === 'string') {
                        await this.performAntigravityToolsJsonImport(message.jsonText);
                    } else {
                        const err = 'JSON content is empty';
                        this.hud.sendMessage({
                            type: 'antigravityToolsSyncComplete',
                            data: { success: false, error: err },
                        });
                        vscode.window.showWarningMessage(err);
                    }
                    break;

                case 'antigravityToolsSync.cancel':
                    if (this.importCancelToken) {
                        this.importCancelToken.cancelled = true;
                        logger.info('[AntigravityToolsSync] User cancelled import operation');
                    }
                    break;

                case 'antigravityToolsSync.toggle':
                    if (typeof message.enabled === 'boolean') {
                        // Auto sync has been deprecated and is now fixed OFF.
                        await configService.setStateFlag('antigravityToolsSyncEnabled', false);
                        this.hud.sendMessage({
                            type: 'antigravityToolsSyncStatus',
                            data: { autoSyncEnabled: false },
                        });
                    }
                    break;

                case 'antigravityToolsSync.switchToClient':
                    await this.handleSwitchToClientAccount();
                    break;

                case 'updateLanguage':
                    if (message.language !== undefined) {
                        const rawLanguage = String(message.language);
                        const newLanguage = normalizeLocaleInput(rawLanguage);
                        logger.info(`User changed language to: ${newLanguage}`);
                        await configService.updateConfig('language', newLanguage);
                        i18n.applyLanguageSetting(newLanguage);
                        const languageForSync = newLanguage === 'auto' ? i18n.getLocale() : newLanguage;
                        
                        if (cockpitToolsWs.isConnected) {

                            const syncResult = await cockpitToolsWs.setLanguage(languageForSync, 'extension');
                            if (!syncResult.success) {
                                logger.warn(`[WS] Failed to sync language to desktop: ${syncResult.message}`);
                            }
                        } else {
                            const { writeSyncSetting } = await import('../services/syncSettings');
                            writeSyncSetting('language', languageForSync);
                            logger.info(`[SyncSettings] Language written to shared file (offline mode): ${languageForSync}`);
                        }
                        
                        this.hud.dispose();
                        setTimeout(() => {
                            vscode.commands.executeCommand('agCockpit.open');
                        }, 100);
                    }
                    break;

                case 'saveCustomGrouping': {
                    const { customGroupMappings, customGroupNames } = message;
                    if (customGroupMappings) {
                        logger.info(`User saved custom grouping: ${Object.keys(customGroupMappings).length} models`);
                        await configService.updateGroupMappings(customGroupMappings);


                        await configService.updateConfig('pinnedGroups', []);

                        if (customGroupNames) {
                            await configService.updateConfig('groupingCustomNames', customGroupNames);
                        }


                        this.reactor.reprocess();
                    }
                    break;
                }

                // ============ Auto Trigger ============
                case 'tabChanged':
                    if (message.tab === 'accounts') {
                        await configService.setStateValue('lastActiveView', 'accountsOverview');
                        this.hud.syncAccountsToWebview();
                    } else {
                        await configService.setStateValue('lastActiveView', 'dashboard');
                    }


                    if (message.tab === 'auto-trigger') {
                        logger.debug('Switched to Auto Trigger tab');
                        const state = await autoTriggerController.getState();
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                    }
                    break;

                case 'quotaHistory.get': {
                    const isValidEmail = (value?: string | null): value is string => typeof value === 'string' && value.includes('@');
                    const requestedEmail = message.email;
                    const activeEmail = await credentialStorage.getActiveAccount();
                    const latestSnapshot = this.reactor.getLatestSnapshot();
                    const snapshotEmail = latestSnapshot?.userInfo?.email || latestSnapshot?.localAccountEmail || null;
                    const resolvedEmail = isValidEmail(requestedEmail)
                        ? requestedEmail
                        : (isValidEmail(activeEmail) ? activeEmail : (isValidEmail(snapshotEmail) ? snapshotEmail : null));

                    const credentials = await credentialStorage.getAllCredentials();
                    const accounts = Object.keys(credentials);
                    if (isValidEmail(snapshotEmail) && !accounts.includes(snapshotEmail)) {
                        accounts.push(snapshotEmail);
                    }
                    accounts.sort();

                    const history = await getQuotaHistory(resolvedEmail, message.rangeDays, message.modelId);
                    this.hud.sendMessage({
                        type: 'quotaHistoryData',
                        data: {
                            email: resolvedEmail,
                            accounts,
                            rangeDays: history?.rangeDays ?? message.rangeDays,
                            modelId: history?.modelId ?? message.modelId ?? null,
                            models: history?.models || [],
                            points: history?.points || [],
                        },
                    });
                    break;
                }

                case 'clearHistorySingle':
                    if (message.email) {
                        logger.info(`User clearing history for account: ${message.email}`);
                        await clearHistory(message.email);
                        this.hud.sendMessage({ type: 'quotaHistoryCleared' });
                        vscode.window.showInformationMessage(t('history.cleared') || 'History cleared.');
                    }
                    break;

                case 'clearHistoryAll':
                    logger.info('User clearing all history');
                    await clearAllHistory();
                    this.hud.sendMessage({ type: 'quotaHistoryCleared' });
                    vscode.window.showInformationMessage(t('history.allCleared') || 'All history cleared.');
                    break;

                case 'autoTrigger.authorize':
                    logger.info('User triggered OAuth authorization');
                    try {
                        await autoTriggerController.authorize();
                        const state = await autoTriggerController.getState();
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                        if (configService.getConfig().quotaSource === 'authorized') {
                            this.reactor.syncTelemetry();
                        }
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        logger.error(`Authorization failed: ${err.message}`);
                        vscode.window.showErrorMessage(`Authorization failed: ${err.message}`);
                    }
                    break;

                case 'autoTrigger.importLocal':
                    await this.handleLocalAuthImport();
                    break;
                case 'autoTrigger.importLocalConfirm':
                    await this.handleLocalAuthImportConfirm(message.overwrite === true);
                    break;

                case 'autoTrigger.revoke':
                    logger.info('User revoked OAuth authorization');
                    await autoTriggerController.revokeActiveAccount();
                    {
                        const state = await autoTriggerController.getState();
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                    }
                    if (configService.getConfig().quotaSource === 'authorized') {
                        this.reactor.syncTelemetry();
                    }
                    break;

                case 'autoTrigger.confirmRisk':
                    {
                        const riskAction = message.riskAction === 'test' ? 'test' : 'enable';
                        const warningText = t('autoTrigger.enableRiskWarning');
                        const openCockpitToolsAction: vscode.MessageItem = {
                            title: t('autoTrigger.openCockpitToolsRecommended'),
                        };
                        const continuePluginWakeupAction: vscode.MessageItem = {
                            title: t('autoTrigger.continuePluginWakeup'),
                        };
                        const selection = await vscode.window.showWarningMessage(
                            warningText,
                            { modal: true },
                            openCockpitToolsAction,
                            continuePluginWakeupAction,
                        );
                        if (selection === openCockpitToolsAction) {
                            await this.openCockpitToolsOrDownload();
                        }
                        this.hud.sendMessage({
                            type: 'autoTriggerRiskConfirmResult',
                            data: {
                                action: riskAction,
                                confirmed: selection === continuePluginWakeupAction,
                            },
                        });
                    }
                    break;

                case 'autoTrigger.saveSchedule':
                    if (message.schedule) {
                        logger.info('User saved auto trigger schedule');
                        await autoTriggerController.saveSchedule(message.schedule);
                        const state = await autoTriggerController.getState();
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                        vscode.window.showInformationMessage(t('autoTrigger.saved'));
                    }
                    break;

                case 'autoTrigger.test':
                    logger.info('User triggered manual test');
                    try {
                        const rawModels = (message as { models?: unknown }).models;
                        const testModels = Array.isArray(rawModels)
                            ? rawModels.filter((model): model is string => typeof model === 'string' && model.length > 0)
                            : undefined;
                        const customPrompt = (message as { customPrompt?: string }).customPrompt;
                        const rawMaxOutputTokens = (message as { maxOutputTokens?: unknown }).maxOutputTokens;
                        const parsedMaxOutputTokens = typeof rawMaxOutputTokens === 'number'
                            ? rawMaxOutputTokens
                            : (typeof rawMaxOutputTokens === 'string' ? Number(rawMaxOutputTokens) : undefined);
                        const maxOutputTokens = typeof parsedMaxOutputTokens === 'number'
                            && Number.isFinite(parsedMaxOutputTokens)
                            && parsedMaxOutputTokens > 0
                            ? Math.floor(parsedMaxOutputTokens)
                            : undefined;
                        const rawAccounts = (message as { accounts?: unknown }).accounts;
                        const testAccounts = Array.isArray(rawAccounts)
                            ? rawAccounts.filter((email): email is string => typeof email === 'string' && email.length > 0)
                            : undefined;
                        const result = await autoTriggerController.triggerNow(testModels, customPrompt, testAccounts, maxOutputTokens);
                        const state = await autoTriggerController.getState();
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                        if (result.success) {

                            const successMsg = t('autoTrigger.triggerSuccess').replace('{duration}', String(result.duration));
                            const responsePreview = result.response
                                ? `\n${result.response.substring(0, 200)}${result.response.length > 200 ? '...' : ''}`
                                : '';
                            vscode.window.showInformationMessage(successMsg + responsePreview);
                        } else {
                            vscode.window.showErrorMessage(
                                t('autoTrigger.triggerFailed').replace('{message}', result.error || 'Unknown error'),
                            );
                        }
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        vscode.window.showErrorMessage(
                            t('autoTrigger.triggerFailed').replace('{message}', err.message),
                        );
                    }
                    break;

                case 'autoTrigger.validateCrontab':
                    if (message.crontab) {
                        const result = autoTriggerController.validateCrontab(message.crontab);
                        this.hud.sendMessage({
                            type: 'crontabValidation',
                            data: result,
                        });
                    }
                    break;

                case 'autoTrigger.clearHistory':
                    {
                        logger.info('User cleared trigger history');
                        await autoTriggerController.clearHistory();
                        const state = await autoTriggerController.getState();
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                        vscode.window.showInformationMessage(t('autoTrigger.historyCleared'));
                    }
                    break;

                case 'getAutoTriggerState':
                case 'autoTrigger.getState':
                    {
                        const state = await autoTriggerController.getState();
                        const accountCount = state.authorization?.accounts?.length ?? 0;
                        const activeAccount = state.authorization?.activeAccount ?? state.authorization?.email ?? 'none';
                        logger.info(`[Webview] autoTriggerState accounts=${accountCount} active=${activeAccount}`);
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                    }
                    break;

                case 'autoTrigger.addAccount':
                    // Same as authorize - adds a new account
                    logger.info('User adding new account');
                    try {
                        await autoTriggerController.authorize();
                        const state = await autoTriggerController.getState();
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                        if (configService.getConfig().quotaSource === 'authorized') {
                            this.reactor.syncTelemetry();
                        }
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        logger.error(`Add account failed: ${err.message}`);
                        vscode.window.showErrorMessage(`Add account failed: ${err.message}`);
                    }
                    break;

                case 'autoTrigger.removeAccount':
                    if (message.email) {
                        logger.info(`User removing account: ${message.email}`);
                        await autoTriggerController.removeAccount(message.email);
                        const state = await autoTriggerController.getState();
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                        if (configService.getConfig().quotaSource === 'authorized') {
                            this.reactor.syncTelemetry();
                        }
                    } else {
                        logger.warn('removeAccount missing email');
                    }
                    break;

                case 'autoTrigger.switchAccount':
                    if (message.email) {
                        logger.info(`User switching to account: ${message.email}`);
                        await autoTriggerController.switchAccount(message.email);
                        const state = await autoTriggerController.getState();
                        this.hud.sendMessage({
                            type: 'autoTriggerState',
                            data: state,
                        });
                        if (configService.getConfig().quotaSource === 'authorized') {
                            const usedCache = await this.reactor.tryUseQuotaCache('authorized', message.email);
                            if (!usedCache) {
                                this.reactor.syncTelemetry();
                            }
                        }
                    } else {
                        logger.warn('switchAccount missing email');
                    }
                    break;

                case 'autoTrigger.switchLoginAccount':
                    if (message.email) {
                        logger.info(`User switching login account to: ${message.email}`);
                        const execution = await this.executeAccountSwitch({
                            targetEmail: message.email,
                            switchMode: 'default',
                            triggerType: 'manual',
                            triggerSource: 'webview.autoTrigger.switchLoginAccount',
                        });
                        if (execution.success) {
                            const successMessage = accountSwitchService.isSeamlessMode(execution.effectiveMode)
                                ? `Seamlessly switched login account to ${execution.toEmail}`
                                : (t('autoTrigger.switchLoginSuccess') || `Switched login account to ${message.email}`);
                            vscode.window.showInformationMessage(successMessage);
                        } else if (execution.errorCode === 'tools_offline' && execution.effectiveMode === 'default') {
                            await this.showToolsNotRunningActions();
                        } else {
                            const failedMessage = t('autoTrigger.switchLoginFailed') || 'Switch login account failed';
                            vscode.window.showErrorMessage(`${failedMessage}: ${execution.errorMessage || 'Unknown error'}`);
                        }
                    } else {
                        logger.warn('switchLoginAccount missing email');
                    }
                    break;

                case 'autoTrigger.reauthorizeAccount':
                    // Re-authorize logic... (keep existing if any code follows, but here it was just the case label)
                    // ... existing logic ...
                    break; 

                    // ============ Accounts Overview Handlers ============

                case 'refreshAll':
                    if (this.refreshService) {
                        cockpitToolsWs.ensureConnected();
                        const refreshed = await this.refreshService.manualRefresh();
                        if (!refreshed) {
                            this.hud.syncAccountsToWebview();
                        }
                        // refreshService updates notify HUD via subscription in hud.ts
                    }
                    break;

                case 'refreshAccount':
                    if (typeof message.email === 'string' && this.refreshService) {
                        await this.refreshService.loadAccountQuota(message.email);
                    }
                    break;
                
                case 'switchAccount': // Alias for switching client account
                    if (typeof message.email === 'string') {
                        const email = message.email;
                        logger.info(`[MsgCtrl] Switching account to: ${email}`);
                        this.hud.sendMessage({
                            type: 'actionProgress',
                            data: { context: 'switch', message: `Switching to ${email}...` },
                        });
                        const execution = await this.executeAccountSwitch({
                            targetEmail: email,
                            switchMode: 'default',
                            triggerType: 'manual',
                            triggerSource: 'webview.accounts.switchAccount',
                        });
                        if (execution.success) {
                            const switchedEmail = execution.toEmail;
                            const successMessage = accountSwitchService.isSeamlessMode(execution.effectiveMode)
                                ? `Seamlessly switched to ${switchedEmail}`
                                : t('accountsOverview.switchSuccess', { email: switchedEmail });
                            const markerMessage = `Current account marker switched to ${switchedEmail}`;
                            this.hud.sendMessage({
                                type: 'actionResult',
                                data: { status: 'success', message: `${successMessage}。${markerMessage}` },
                            });
                            vscode.window.showInformationMessage(`${successMessage}，${markerMessage}`);
                            logger.info(
                                `[MsgCtrl] switchAccount completed with marker update: target=${email}, current=${switchedEmail}, mode=${execution.effectiveMode}`,
                            );
                        } else if (execution.errorCode === 'tools_offline' && execution.effectiveMode === 'default') {
                            this.hud.sendMessage({
                                type: 'actionResult',
                                data: {
                                    status: 'error',
                                    message: execution.errorMessage || t('accountsOverview.switchFailed', { error: 'Cockpit Tools not running' }),
                                },
                            });
                            await this.showToolsNotRunningActions();
                        } else {
                            const failedMessage = execution.errorMessage || t('accountsOverview.switchFailed', { error: 'Unknown' });
                            this.hud.sendMessage({
                                type: 'actionResult',
                                data: { status: 'error', message: failedMessage },
                            });
                            vscode.window.showErrorMessage(failedMessage);
                            logger.warn(
                                `[MsgCtrl] switchAccount failed: target=${email}, mode=${execution.effectiveMode}, code=${execution.errorCode ?? 'none'}, message=${failedMessage}`,
                            );
                        }
                    }
                    break;

                case 'deleteAccount':
                    if (typeof message.email === 'string') {
                        try {
                            await autoTriggerController.removeAccount(message.email);
                            if (this.refreshService) {await this.refreshService.refresh();}
                            this.hud.sendMessage({
                                type: 'actionResult',
                                data: { status: 'success', message: t('accountsOverview.deleteSuccess', { email: message.email }) },
                            });
                        } catch (e) {
                            const err = e instanceof Error ? e : new Error(String(e));
                            this.hud.sendMessage({
                                type: 'actionResult',
                                data: { status: 'error', message: err.message },
                            });
                        }
                    }
                    break;

                case 'deleteAccounts':
                    if (Array.isArray(message.emails)) {
                        let successCount = 0;
                        for (const email of message.emails) {
                            try {
                                await autoTriggerController.removeAccount(email);
                                successCount++;
                            } catch (error) {
                                logger.warn(`Failed to delete ${email}: ${error}`);
                            }
                        }
                        if (this.refreshService) {await this.refreshService.refresh();}
                        this.hud.sendMessage({
                            type: 'actionResult',
                            data: { status: 'success', message: t('accountsOverview.deleteBatchSuccess', { count: successCount }) },
                        });
                    }
                    break;

                case 'addAccount':
                    // Complex add account flow with modes
                    {
                        const mode = typeof message.mode === 'string' ? message.mode : undefined;
                        try {
                            if (mode === 'prepare' || mode === 'start') {
                                const url = await oauthService.prepareAuthorizationSession();
                                this.hud.sendMessage({ type: 'oauthUrl', data: { url } });
                                if (mode === 'start' && url) {
                                    vscode.env.openExternal(vscode.Uri.parse(url));
                                }
                            } else if (mode === 'cancel') {
                                oauthService.cancelAuthorizationSession();
                            } else if (mode === 'continue' || !mode) {
                                // Default flow
                                const success = await oauthService.startAuthorization();
                                if (success) {
                                    if (this.refreshService) {await this.refreshService.refresh();}
                                    this.hud.sendMessage({
                                        type: 'actionResult',
                                        data: { status: 'success', message: t('accountsOverview.addSuccess'), closeModal: true },
                                    });
                                } else {
                                    this.hud.sendMessage({
                                        type: 'actionResult',
                                        data: { status: 'error', message: t('accountsOverview.addFailed', { error: 'Unknown' }) },
                                    });
                                }
                            }
                        } catch (e) {
                            const err = e instanceof Error ? e : new Error(String(e));
                            this.hud.sendMessage({
                                type: 'actionResult',
                                data: { status: 'error', message: err.message },
                            });
                        }
                    }
                    break;

                case 'importTokens':
                    if (typeof message.content === 'string') {
                        // Note: Logic needs to be implemented or imported. 
                        // For now, let's defer or implement basic parsing if possible.
                        // But imported refresh tokens need to be saved to DB.
                        // autoTriggerController doesn't expose raw import? 
                        // Actually `credentialStorage` has `saveCredential`.
                        // Let's implement basic JSON parsing here.
                        try {
                            let tokens: Record<string, unknown>[] = [];
                            try {
                                const parsed = JSON.parse(message.content);
                                tokens = Array.isArray(parsed) ? parsed : [parsed];
                            } catch {
                                tokens = message.content.split('\n').filter(line => line.trim()).map(line => ({ refresh_token: line.trim() }));
                            }
                             
                            let count = 0;
                            let errors = 0;
                            for (const item of tokens) {
                                const refreshToken = item.refresh_token as string | undefined;
                                if (typeof refreshToken === 'string' && refreshToken) {
                                    try {

                                        const emailArg = typeof item.email === 'string' ? item.email : undefined;
                                        const credential = await oauthService.buildCredentialFromRefreshToken(refreshToken, emailArg);
                                        await credentialStorage.saveCredentialForAccount(credential.email, credential);
                                        count++;
                                    } catch (error) {
                                        const err = error instanceof Error ? error : new Error(String(error));
                                        errors++;
                                        logger.warn(`Failed to import token: ${err.message}`);
                                    }
                                }
                            }
                             
                            if (count > 0 && this.refreshService) {
                                await this.refreshService.refresh();
                            }

                            let messageText = '';
                            let status: 'success' | 'error' | 'warning' = 'success';
                            if (count > 0) {
                                messageText = t('accountsOverview.tokenImportSuccess') || `Successfully imported ${count} accounts.`;
                                if (errors > 0) {
                                    messageText += ` (${errors} failed)`;
                                    status = 'warning';
                                }
                            } else {
                                messageText = t('accountsOverview.tokenImportFailed') || 'Import failed.';
                                status = 'error';
                            }

                            this.hud.sendMessage({
                                type: 'actionResult',
                                data: { status, message: messageText, closeModal: count > 0 },
                            });
                        } catch (e) {
                            this.hud.sendMessage({
                                type: 'actionResult',
                                data: { status: 'error', message: 'Invalid JSON format' },
                            });
                        }
                    }
                    break;

                case 'importFromExtension':
                    // Reuse antigravityToolsSync logic
                    await this.handleAntigravityToolsImport(false); // force=false? Actually importFromExtension usually means sync.
                    break;

                case 'importFromLocal':
                    await this.handleLocalAuthImport();
                    break;
                
                case 'importFromTools':
                    // Same as antigravityToolsSync.import
                    await this.handleAntigravityToolsImport(false);
                    break;

                case 'exportAccounts':
                    // Generate JSON of accounts and copy to clipboard
                    if (Array.isArray(message.emails)) {
                        const creds = await credentialStorage.getAllCredentials();
                        const exportData = message.emails
                            .filter((e: string) => creds[e])
                            .map((e: string) => ({ email: e, refresh_token: creds[e].refreshToken }));
                         
                        const jsonStr = JSON.stringify(exportData, null, 2);
                        await vscode.env.clipboard.writeText(jsonStr);
                         
                        this.hud.sendMessage({
                            type: 'actionResult',
                            data: { 
                                status: 'success', 
                                message: t('accountsOverview.exportSuccess', { count: exportData.length }) || `Successfully exported ${exportData.length} accounts to clipboard.`, 
                            },
                        });
                    }
                    break;

                    if (message.email) {
                        logger.info(`User reauthorizing account: ${message.email}`);
                        try {

                            await autoTriggerController.reauthorizeAccount(message.email);
                            const state = await autoTriggerController.getState();
                            this.hud.sendMessage({
                                type: 'autoTriggerState',
                                data: state,
                            });
                            if (configService.getConfig().quotaSource === 'authorized') {
                                this.reactor.syncTelemetry();
                            }
                            vscode.window.showInformationMessage(t('autoTrigger.reauthorizeSuccess'));
                        } catch (error) {
                            const err = error instanceof Error ? error : new Error(String(error));
                            logger.error(`Reauthorize account failed: ${err.message}`);
                            vscode.window.showErrorMessage(`Reauthorize failed: ${err.message}`);
                        }
                    } else {
                        logger.warn('reauthorizeAccount missing email');
                    }
                    break;


                // ============ Announcements ============
                case 'announcement.getState':
                    {
                        const state = await announcementService.getState();
                        this.hud.sendMessage({
                            type: 'announcementState',
                            data: state,
                        });
                    }
                    break;

                case 'announcement.markAsRead':
                    if (message.id) {
                        await announcementService.markAsRead(message.id);
                        logger.debug(`Marked announcement as read: ${message.id}`);
                        const state = await announcementService.getState();
                        this.hud.sendMessage({
                            type: 'announcementState',
                            data: state,
                        });
                    }
                    break;

                case 'announcement.markAllAsRead':
                    await announcementService.markAllAsRead();
                    logger.debug('Marked all announcements as read');
                    {
                        const state = await announcementService.getState();
                        this.hud.sendMessage({
                            type: 'announcementState',
                            data: state,
                        });
                    }
                    break;

                case 'openDashboard':
                    await configService.setStateValue('lastActiveView', 'dashboard');
                    if (typeof message.tab === 'string') {
                        await vscode.commands.executeCommand('agCockpit.open', { tab: message.tab, forceView: 'dashboard' });
                    } else {
                        await vscode.commands.executeCommand('agCockpit.open', { forceView: 'dashboard' });
                    }
                    break;

                case 'openUrl':
                    if (message.url) {
                        vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;

                case 'executeCommand':
                    if (message.commandId) {
                        const args = message.commandArgs;
                        if (args && Array.isArray(args) && args.length > 0) {
                            await vscode.commands.executeCommand(message.commandId, ...args);
                        } else {
                            await vscode.commands.executeCommand(message.commandId);
                        }
                    }
                    break;

                // Cockpit Tools All Accounts Tab
                case 'getCockpitToolsAccounts': {
                    try {
                        const allAccounts = readAllCockpitAccounts();
                        this.hud.sendAllCockpitAccountsToWebview(allAccounts);
                    } catch (err) {
                        logger.error(`[CockpitTools] Failed to read all accounts: ${err instanceof Error ? err.message : String(err)}`);
                    }
                    break;
                }

                case 'cockpitToolsImportCodex':
                    await vscode.commands.executeCommand('agCockpit.importCockpitAccounts');
                    break;

            }
        });
    }

    private async handleLocalAuthImport(): Promise<void> {
        try {
            const snapshotEmail = this.reactor.getLatestSnapshot()?.userInfo?.email;
            const fallbackEmail = snapshotEmail && snapshotEmail !== 'N/A' && snapshotEmail.includes('@')
                ? snapshotEmail
                : undefined;
            const preview = await previewLocalCredential(fallbackEmail);
            this.hud.sendMessage({
                type: 'localAuthImportPrompt',
                data: {
                    email: preview.email,
                    exists: preview.exists,
                },
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[LocalAuthImport] Failed: ${err.message}`);
            this.hud.sendMessage({
                type: 'localAuthImportError',
                data: {
                    message: err.message,
                },
            });
            vscode.window.showErrorMessage(
                t('quotaSource.importLocalFailed', { message: err.message })
                || `Import failed: ${err.message}`,
            );
        }
    }

    private async handleLocalAuthImportConfirm(overwrite: boolean): Promise<void> {
        try {
            const snapshotEmail = this.reactor.getLatestSnapshot()?.userInfo?.email;
            const fallbackEmail = snapshotEmail && snapshotEmail !== 'N/A' && snapshotEmail.includes('@')
                ? snapshotEmail
                : undefined;
            const result = await commitLocalCredential({ overwrite, fallbackEmail });
            const state = await autoTriggerController.getState();
            this.hud.sendMessage({
                type: 'autoTriggerState',
                data: state,
            });
            if (configService.getConfig().quotaSource === 'authorized') {
                this.reactor.syncTelemetry();
            }
            vscode.window.showInformationMessage(
                t('quotaSource.importLocalSuccess', { email: result.email })
                || `Imported account: ${result.email}`,
            );
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[LocalAuthImport] Confirm failed: ${err.message}`);
            vscode.window.showErrorMessage(
                t('quotaSource.importLocalFailed', { message: err.message })
                || `Import failed: ${err.message}`,
            );
        }
    }

    /**
     *
     * @param isAuto
     */
    private async handleAntigravityToolsImport(isAuto: boolean): Promise<void> {
        try {
            const autoSyncEnabled = configService.getStateFlag('antigravityToolsSyncEnabled', false);
            if (isAuto && !autoSyncEnabled) {
                return;
            }
            const detection = await antigravityToolsSyncService.detect();
            const activeEmail = await credentialStorage.getActiveAccount();
            

            if (!detection || !detection.currentEmail) {
                if (!isAuto) {
                    this.hud.sendMessage({
                        type: 'antigravityToolsSyncPrompt',
                        data: {
                            promptType: 'not_found',
                        },
                    });
                }
                return;
            }

            const sameAccount = activeEmail
                ? detection.currentEmail.toLowerCase() === activeEmail.toLowerCase()
                : false;


            if (detection.newEmails.length > 0) {
                if (isAuto) {
                    if (autoSyncEnabled) {
                        if (this.hud.isVisible()) {
                            this.hud.sendMessage({
                                type: 'antigravityToolsSyncPrompt',
                                data: {
                                    promptType: 'new_accounts',
                                    newEmails: detection.newEmails,
                                    currentEmail: detection.currentEmail,
                                    sameAccount,
                                    autoConfirm: true,
                                    autoConfirmImportOnly: true,
                                },
                            });
                        } else {
                            await this.performAntigravityToolsImport(activeEmail, true, true);
                            vscode.window.showInformationMessage(
                                t('antigravityToolsSync.autoImported', { email: detection.currentEmail }) 
                                || `Auto-synced account: ${detection.currentEmail}`,
                            );
                        }
                        return;
                    }
                } else {
                    this.hud.sendMessage({
                        type: 'antigravityToolsSyncPrompt',
                        data: {
                            promptType: 'new_accounts',
                            newEmails: detection.newEmails,
                            currentEmail: detection.currentEmail,
                            sameAccount,
                            autoConfirm: false,
                        },
                    });
                }
                if (!isAuto) {
                    return;
                }
            }


            if (sameAccount) {
                if (!isAuto) {
                    vscode.window.showInformationMessage(t('antigravityToolsSync.alreadySynced') || 'Already synced, no switch needed');
                }
                return;
            }


            if (isAuto) {
                return;
            } else {
                this.hud.sendMessage({
                    type: 'antigravityToolsSyncPrompt',
                    data: {
                        promptType: 'switch_only',
                        currentEmail: detection.currentEmail,
                        localEmail: activeEmail,
                        currentEmailExistsLocally: detection.currentEmailExistsLocally,
                        autoConfirm: false,
                    },
                });
            }
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            logger.warn(`Antigravity Tools sync detection failed: ${err}`);
            if (!isAuto) {
                vscode.window.showWarningMessage(err);
            }
        }
    }

    /**
     *
     * @param importOnly
     */
    private async performAntigravityToolsImport(activeEmail?: string | null, isAuto: boolean = false, importOnly: boolean = false): Promise<void> {
        this.importCancelToken = { cancelled: false };
        
        try {
            const onProgress = (current: number, total: number, email: string) => {
                this.hud.sendMessage({
                    type: 'antigravityToolsSyncProgress',
                    data: { current, total, email },
                });
            };

            const result = await antigravityToolsSyncService.importAndSwitch(activeEmail, importOnly, onProgress, this.importCancelToken);
            const state = await autoTriggerController.getState();
            this.hud.sendMessage({
                type: 'autoTriggerState',
                data: state,
            });

            this.hud.sendMessage({
                type: 'antigravityToolsSyncComplete',
                data: { success: true },
            });

            if (configService.getConfig().quotaSource === 'authorized' && result.currentAvailable) {
                this.reactor.syncTelemetry();
            }

            if (result.skipped.length > 0) {
                const skipMsg = `Skipped ${result.skipped.length} invalid account(s)`;
                logger.warn(`[AntigravityToolsSync] ${skipMsg}`);
                if (!isAuto) {
                    vscode.window.showWarningMessage(skipMsg);
                }
            }

            if (!result.currentAvailable && !importOnly) {
                const warnMsg = 'Current account import failed, skipping account switch';
                logger.warn(`[AntigravityToolsSync] ${warnMsg}`);
                if (!isAuto) {
                    vscode.window.showWarningMessage(warnMsg);
                }
            }

            if (!isAuto) {
                let message: string;
                if (importOnly) {
                    message = t('antigravityToolsSync.imported');
                } else {
                    message = result.switched
                        ? t('antigravityToolsSync.switched', { email: result.currentEmail })
                        : t('antigravityToolsSync.alreadySynced');
                }
                vscode.window.showInformationMessage(message);
            }
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            logger.warn(`Antigravity Tools import failed: ${err}`);

            this.hud.sendMessage({
                type: 'antigravityToolsSyncComplete',
                data: { success: false, error: err },
            });

            vscode.window.showWarningMessage(err);
        } finally {
            this.importCancelToken = null;
        }
    }

    /**
     *
     */
    private async performAntigravityToolsJsonImport(jsonText: string): Promise<void> {
        this.importCancelToken = { cancelled: false };
        
        try {
            const onProgress = (current: number, total: number, email: string) => {
                this.hud.sendMessage({
                    type: 'antigravityToolsSyncProgress',
                    data: { current, total, email },
                });
            };

            const result = await antigravityToolsSyncService.importFromJson(jsonText, onProgress, this.importCancelToken);
            const state = await autoTriggerController.getState();
            this.hud.sendMessage({
                type: 'autoTriggerState',
                data: state,
            });

            this.hud.sendMessage({
                type: 'antigravityToolsSyncComplete',
                data: { success: true },
            });

            if (configService.getConfig().quotaSource === 'authorized') {
                this.reactor.syncTelemetry();
            }

            if (result.skipped.length > 0) {
                const skipMsg = `Skipped ${result.skipped.length} invalid account(s)`;
                logger.warn(`[AntigravityToolsSync] ${skipMsg}`);
                vscode.window.showWarningMessage(skipMsg);
            }

            const importedMsg = t('antigravityToolsSync.imported') || 'Accounts imported';
            vscode.window.showInformationMessage(importedMsg);
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            logger.warn(`Antigravity Tools JSON import failed: ${err}`);
            this.hud.sendMessage({
                type: 'antigravityToolsSyncComplete',
                data: { success: false, error: err },
            });
            vscode.window.showWarningMessage(err);
        } finally {
            this.importCancelToken = null;
        }
    }

    /**
     *
     *
     * -
     * -
     */
    private async handleSwitchToClientAccount(): Promise<void> {
        try {
            let currentEmail: string | null = null;
            const source = 'local' as const;
            

            try {
                const preview = await previewLocalCredential();
                if (preview?.email) {
                    currentEmail = preview.email;
                    logger.info(`[SwitchToClient] Found local client account: ${currentEmail}`);
                }
            } catch (localErr) {
                logger.debug(`[SwitchToClient] Local client detection failed: ${localErr instanceof Error ? localErr.message : localErr}`);
            }
            
            if (!currentEmail) {
                vscode.window.showWarningMessage(
                    t('antigravityToolsSync.noClientAccount') || 'No client login account detected',
                );
                return;
            }

            const activeEmail = await credentialStorage.getActiveAccount();
            const currentEmailLower = currentEmail.toLowerCase();
            
            if (activeEmail && activeEmail.toLowerCase() === currentEmailLower) {
                vscode.window.showInformationMessage(
                    t('antigravityToolsSync.alreadySynced') || 'Already the current account',
                );
                return;
            }


            const accounts = await credentialStorage.getAllCredentials();
            const existingEmail = Object.keys(accounts).find(
                email => email.toLowerCase() === currentEmailLower,
            );

            if (existingEmail) {

                logger.info(`[SwitchToClient] Switching to existing account: ${existingEmail}`);
                await autoTriggerController.switchAccount(existingEmail);
                const state = await autoTriggerController.getState();
                this.hud.sendMessage({ type: 'autoTriggerState', data: state });
                
                const source = configService.getConfig().quotaSource === 'authorized' ? 'authorized' : 'local';
                const usedCache = await this.reactor.tryUseQuotaCache(source, existingEmail);
                if (!usedCache) {
                    this.reactor.syncTelemetry();
                }
                
                vscode.window.showInformationMessage(
                    t('autoTrigger.accountSwitched', { email: existingEmail }) 
                    || `Switched to: ${existingEmail}`,
                );
            } else {
                logger.info(`[SwitchToClient] Account not found, showing import prompt for: ${currentEmail} (source: ${source})`);
                this.hud.sendMessage({
                    type: 'antigravityToolsSyncPrompt',
                    data: {
                        promptType: 'new_accounts',
                        newEmails: [currentEmail],
                        currentEmail: currentEmail,
                        localEmail: source === 'local' ? currentEmail : undefined,
                        sameAccount: false,
                        autoConfirm: false,
                    },
                });
            }
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            logger.warn(`[SwitchToClient] Failed: ${err}`);
            vscode.window.showWarningMessage(
                t('antigravityToolsSync.switchFailed', { message: err }) || `Switch failed: ${err}`,
            );
        }
    }

    private async openCockpitToolsOrDownload(): Promise<void> {
        const opened = await openCockpitToolsDesktop('AutoTriggerRisk');

        if (!opened) {
            await this.downloadCockpitTools();
        }
    }

    private async downloadCockpitTools(): Promise<void> {
        const cockpitToolsReleaseUrl = 'https://github.com/jlcodes99/antigravity-cockpit-tools/releases';
        await vscode.env.openExternal(vscode.Uri.parse(cockpitToolsReleaseUrl));
    }
}
