/**
 * Antigravity Cockpit - Extension Entry Point
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProcessHunter } from './engine/hunter';
import { ReactorCore } from './engine/reactor';
import { logger } from './shared/log_service';
import { setAntigravityRemoteName, setAntigravityUserDataDir, getCockpitToolsSharedDir } from './shared/antigravity_paths';
import { configService, CockpitConfig } from './shared/config_service';
import { t, i18n, normalizeLocaleInput } from './shared/i18n';
import { getOfficialIdeVersion, getOfficialProductJsonPath } from './shared/official_host_version';
import { CockpitHUD } from './view/hud';
import { QuickPickView } from './view/quickpick_view';
import { AccountsRefreshService } from './services/accountsRefreshService';

// Controllers
import { StatusBarController } from './controller/status_bar_controller';
import { CommandController } from './controller/command_controller';
import { AccountSwitchExecutionRequest, MessageController } from './controller/message_controller';
import { TelemetryController } from './controller/telemetry_controller';
import { autoTriggerController } from './auto_trigger/controller';
import { credentialStorage } from './auto_trigger';
import { debugLocalCredentialImport } from './auto_trigger/local_auth_importer';
import { importAccountsFromDir } from './services/importService';
import { antigravityToolsSyncService } from './antigravityTools_sync';
import { announcementService } from './announcement';
import { readAllCockpitAccounts } from './services/cockpitToolsAllAccounts';
import { activateStorageManager } from './storage_manager/index';

// Account Tree View
import { AccountTreeProvider, registerAccountTreeCommands } from './view/accountTree';

// WebSocket Client
import {
    cockpitToolsWs,
    PluginSetSwitchModePayload,
    PluginSwitchAccountPayload,
    WsSwitchMode,
} from './services/cockpitToolsWs';
import { cockpitToolsSyncEvents } from './services/cockpitToolsSync';
import { accountSwitchService, AccountSwitchMode, AccountSwitchModeInput } from './services/accountSwitchService';

let hunter: ProcessHunter;
let reactor: ReactorCore;
let hud: CockpitHUD;
let quickPickView: QuickPickView;
let accountsRefreshService: AccountsRefreshService;

// Controllers
let statusBar: StatusBarController;
let _commandController: CommandController;
let _messageController: MessageController;
let _telemetryController: TelemetryController;

let systemOnline = false;
let lastQuotaSource: 'local' | 'authorized';

let autoRetryCount = 0;
const MAX_AUTO_RETRY = 3;
const AUTO_RETRY_DELAY_MS = 5000;
const OFFICIAL_ANTIGRAVITY_EXTENSION_ID = 'google.antigravity';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger.init();
    logOfficialAntigravityIdeVersion();
    await configService.initialize(context);
    const modelPrefMigrationSummary = configService.getLastModelPreferenceMigrationSummary();
    if (modelPrefMigrationSummary?.changed) {
        const replacedRefs = Object.values(modelPrefMigrationSummary.replacementCounts)
            .reduce((sum, count) => sum + count, 0);
        void vscode.window.showInformationMessage(
            `Some retired models have been automatically migrated to new versions (updated ${replacedRefs} references: ${modelPrefMigrationSummary.changedFields.join(', ')}).`,
        );
    }

    try {
        const userDataDir = path.resolve(context.globalStorageUri.fsPath, '..', '..', '..');
        setAntigravityRemoteName(vscode.env.remoteName ?? null);
        setAntigravityUserDataDir(userDataDir);
        logger.info(`[Startup] Resolved user-data-dir: ${userDataDir}, remote=${vscode.env.remoteName ?? 'local'}`);
    } catch (err) {
        logger.warn(`[Startup] Failed to resolve user-data-dir: ${err instanceof Error ? err.message : String(err)}`);
    }

    const savedLanguage = configService.getConfig().language;
    if (savedLanguage) {
        i18n.applyLanguageSetting(savedLanguage);
    }

    try {
        const { mergeSettingOnStartup } = await import('./services/syncSettings');
        const mergedLanguage = mergeSettingOnStartup('language', savedLanguage || 'auto');
        if (mergedLanguage) {
            logger.info(`[SyncSettings] Merged language setting on startup: ${savedLanguage} -> ${mergedLanguage}`);
            await configService.updateConfig('language', mergedLanguage);
            i18n.applyLanguageSetting(mergedLanguage);
        }
    } catch (err) {
        logger.debug(`[SyncSettings] Startup sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const packageJson = await import('../package.json');
    const version = packageJson.version || 'unknown';

    const lastVersion = context.globalState.get<string>('state.lastVersion');
    if (lastVersion !== version) {
        logger.info(`[Startup] Version changed (${lastVersion ?? 'none'} -> ${version}), reset visibleModels`);
        await configService.updateVisibleModels([]);
        await context.globalState.update('state.lastVersion', version);
    }

    logger.info(`Antigravity Cockpit v${version} - Systems Online`);

    hunter = new ProcessHunter();
    reactor = new ReactorCore();
    accountsRefreshService = new AccountsRefreshService(reactor);
    hud = new CockpitHUD(context.extensionUri, context, accountsRefreshService);
    quickPickView = new QuickPickView();
    lastQuotaSource = configService.getConfig().quotaSource === 'authorized' ? 'authorized' : 'local';

    context.subscriptions.push(
        vscode.commands.registerCommand('agCockpit.openAccountsOverview', async () => {
            await configService.setStateValue('lastActiveView', 'accountsOverview');
            vscode.commands.executeCommand('agCockpit.open', { tab: 'accounts' });
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agCockpit.backToDashboard', async () => {
            await configService.setStateValue('lastActiveView', 'dashboard');
            setTimeout(() => {
                vscode.commands.executeCommand('agCockpit.open', { tab: 'quota', forceView: 'dashboard' });
            }, 100);
        }),
    );

    context.subscriptions.push(hud.registerSerializer());

    quickPickView.onRefresh(() => {
        reactor.syncTelemetry();
    });

    statusBar = new StatusBarController(context);

    const syncStatusBarFromAccountsCache = (): void => {
        const currentEmail = accountsRefreshService.getCurrentEmail();
        if (!currentEmail) {
            return;
        }
        const cache = accountsRefreshService.getQuotaCache(currentEmail);
        if (!cache || cache.loading || cache.error || !cache.snapshot?.isConnected) {
            return;
        }
        try {
            statusBar.update(cache.snapshot, configService.getConfig());
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.debug(`[StatusBar] Sync from accounts cache skipped: ${err.message}`);
        }
    };

    context.subscriptions.push(
        accountsRefreshService.onDidUpdate(() => {
            syncStatusBarFromAccountsCache();
        }),
    );

    const onRetry = async () => {
        systemOnline = false;
        await bootSystems();
    };

    _telemetryController = new TelemetryController(reactor, statusBar, hud, quickPickView, onRetry);
    _messageController = new MessageController(context, hud, reactor, onRetry, accountsRefreshService);
    _commandController = new CommandController(context, hud, quickPickView, reactor, onRetry);

    autoTriggerController.initialize(context);

    try {
        const syncResult = await autoTriggerController.syncToClientAccountOnStartup();
        if (syncResult === 'switched') {
            logger.info('[Startup] Auto-switched to client account');
        }
    } catch (err) {
        logger.debug(`[Startup] Account sync skipped: ${err instanceof Error ? err.message : err}`);
    }

    announcementService.initialize(context);


    const accountTreeProvider = new AccountTreeProvider(accountsRefreshService);
    const accountTreeView = vscode.window.createTreeView('agCockpit.accountTree', {
        treeDataProvider: accountTreeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(accountTreeView);
    context.subscriptions.push({ dispose: () => accountsRefreshService.dispose() });
    registerAccountTreeCommands(context, accountTreeProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand('agCockpit.debugLocalAccount', async () => {
            try {
                const result = await debugLocalCredentialImport();
                vscode.window.showInformationMessage(
                    `Local account: ${result.email ?? 'null'} | DB: ${result.dbPath}`,
                );
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                vscode.window.showErrorMessage(`Local account debug failed: ${err.message}`);
            }
        }),
    );

    // Import Cockpit Tools accounts from a directory into ~/.antigravity_cockpit/
    context.subscriptions.push(
        vscode.commands.registerCommand('agCockpit.importCockpitAccounts', async () => {
            // Let the user pick an import directory; default to the extension's
            // bundled `import/` folder so they can just press Enter.
            const defaultUri = vscode.Uri.file(
                path.join(context.extensionPath, 'import'),
            );

            const picked = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri,
                openLabel: 'Import accounts from this folder',
                title: 'Select folder with exported Cockpit Tools accounts',
            });

            const importDir = picked?.[0]?.fsPath;
            if (!importDir) {
                return; // cancelled
            }

            try {
                const result = await importAccountsFromDir(importDir);

                if (result.imported === 0 && result.skipped === 0 && result.errors.length === 0) {
                    vscode.window.showWarningMessage(
                        'Import Cockpit Accounts: no account files found in the selected folder.',
                    );
                    return;
                }

                const parts: string[] = [];
                if (result.imported > 0) {
                    parts.push(`Imported ${result.imported} account(s)`);
                }
                if (result.skipped > 0) {
                    parts.push(`${result.skipped} already existed`);
                }
                if (result.errors.length > 0) {
                    parts.push(`${result.errors.length} error(s) — check Output > Antigravity Cockpit`);
                }

                const msg = parts.join(' · ');

                if (result.errors.length > 0) {
                    vscode.window.showWarningMessage(`Import Cockpit Accounts: ${msg}`);
                } else {
                    vscode.window.showInformationMessage(`Import Cockpit Accounts: ${msg}`);
                }

                // Refresh the account tree so newly imported accounts appear immediately
                // (Cockpit Tools desktop will pick them up on its next refresh cycle)
                void vscode.commands.executeCommand('agCockpit.accountTree.refresh');
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                vscode.window.showErrorMessage(`Import Cockpit Accounts failed: ${err.message}`);
                logger.error(`[importCockpitAccounts] ${err.message}`);
            }
        }),
    );

    // Sync Antigravity accounts from Cockpit Tools data directory into VS Code SecretStorage.
    // Reads ~/.antigravity_cockpit/accounts/<uuid>.json files, extracts refresh tokens,
    // and imports them via the OAuth refresh-token exchange endpoint.
    context.subscriptions.push(
        vscode.commands.registerCommand('agCockpit.syncFromCockpitTools', async () => {
            const sharedDir = getCockpitToolsSharedDir();
            const accountsIndexPath = path.join(sharedDir, 'accounts.json');
            const accountsDirPath = path.join(sharedDir, 'accounts');

            let indexData: { accounts?: Array<{ id: string; email: string }> };
            try {
                const raw = fs.readFileSync(accountsIndexPath, 'utf8');
                indexData = JSON.parse(raw) as { accounts?: Array<{ id: string; email: string }> };
            } catch {
                vscode.window.showErrorMessage(
                    'Sync from Cockpit Tools: could not read ~/.antigravity_cockpit/accounts.json',
                );
                return;
            }

            const entries = indexData.accounts ?? [];
            if (entries.length === 0) {
                vscode.window.showWarningMessage('Sync from Cockpit Tools: no accounts found in the index.');
                return;
            }

            // Build [{email, refresh_token}] from individual account files
            const tokenItems: Array<{ email: string; refresh_token: string }> = [];
            for (const entry of entries) {
                try {
                    const accountFilePath = path.join(accountsDirPath, `${entry.id}.json`);
                    const raw = fs.readFileSync(accountFilePath, 'utf8');
                    const accountData = JSON.parse(raw) as {
                        email?: string;
                        token?: { refresh_token?: string; email?: string };
                    };
                    const email = accountData.token?.email ?? accountData.email ?? entry.email;
                    const refreshToken = accountData.token?.refresh_token;
                    if (email && refreshToken) {
                        tokenItems.push({ email, refresh_token: refreshToken });
                    }
                } catch {
                    logger.warn(`[syncFromCockpitTools] Could not read account file for id=${entry.id}`);
                }
            }

            if (tokenItems.length === 0) {
                vscode.window.showWarningMessage('Sync from Cockpit Tools: no valid refresh tokens found.');
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Syncing Antigravity accounts from Cockpit Tools…',
                    cancellable: true,
                },
                async (progress, token) => {
                    const cancelToken = { cancelled: false };
                    token.onCancellationRequested(() => { cancelToken.cancelled = true; });

                    try {
                        const result = await antigravityToolsSyncService.importFromJson(
                            JSON.stringify(tokenItems),
                            (current, total, email) => {
                                progress.report({
                                    message: `${email} (${current}/${total})`,
                                    increment: Math.round(100 / total),
                                });
                            },
                            cancelToken,
                        );

                        const skippedCount = result.skipped.filter(s => s.reason !== 'user_cancelled').length;
                        const parts: string[] = [];
                        if (result.imported > 0) {parts.push(`Synced ${result.imported} account(s)`);}
                        if (skippedCount > 0) {parts.push(`${skippedCount} skipped`);}

                        if (result.imported > 0) {
                            void vscode.commands.executeCommand('agCockpit.accountTree.refresh');
                            vscode.window.showInformationMessage(`Sync from Cockpit Tools: ${parts.join(' · ')}`);
                        } else {
                            vscode.window.showInformationMessage(
                                `Sync from Cockpit Tools: all ${entries.length} account(s) already up to date.`,
                            );
                        }
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        vscode.window.showErrorMessage(`Sync from Cockpit Tools failed: ${msg}`);
                        logger.error(`[syncFromCockpitTools] ${msg}`);
                    }
                },
            );
        }),
    );


    cockpitToolsWs.connect();
    void accountsRefreshService.refreshOnStartup();

    // Auto-load unified Cockpit Tools accounts snapshot on startup.
    // Runs after a short delay so the webview has time to initialise its listeners.
    setTimeout(() => {
        try {
            const allAccounts = readAllCockpitAccounts();
            hud.sendAllCockpitAccountsToWebview(allAccounts);
            logger.info(`[CockpitTools] Auto-loaded ${allAccounts.totalAccounts} accounts across ${allAccounts.sections.length} providers`);
        } catch (err) {
            logger.warn(`[CockpitTools] Auto-load failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, 2000);

    // Activate storage manager features (backup, sync, profiles, Telegram, diagnostics)
    void activateStorageManager(context);

    cockpitToolsSyncEvents.on('localChanged', () => {
        logger.info('[Sync] Webview refreshAccounts');
        hud.sendMessage({ type: 'refreshAccounts' });
    });

    const normalizeRequestedSwitchMode = (value: unknown): AccountSwitchModeInput => {
        if (value === 'default' || value === 'seamless' || value === 'auto') {
            return value;
        }
        return 'auto';
    };

    const normalizeManagedSwitchMode = (value: unknown): AccountSwitchMode | null => {
        if (value === 'default' || value === 'seamless') {
            return value;
        }
        return null;
    };

    const toWsSwitchMode = (mode: AccountSwitchMode): Exclude<WsSwitchMode, 'auto'> => {
        return mode;
    };
    

    cockpitToolsWs.on('connected', () => {
        logger.info('[WS] Connected, refreshing account list');
        void accountsRefreshService.refresh({ reason: 'ws.connected' });
    });

    cockpitToolsWs.on('dataChanged', async (payload: { source?: string }) => {
        const source = payload?.source ?? 'unknown';
        logger.info(`[WS] Received data change notification: ${source}`);
        await accountsRefreshService.refresh({ forceSync: true, skipQuotaRefresh: true, reason: `dataChanged:${source}` });

        hud.sendMessage({ type: 'refreshAccounts' });
    });

    cockpitToolsWs.on('accountSwitched', async (payload: { email: string }) => {
        logger.info(`[WS] Account switched: ${payload.email}`);
        

        await credentialStorage.setActiveAccount(payload.email, true);

        await accountsRefreshService.refresh({ reason: 'ws.accountSwitched' });
        reactor.syncTelemetry();

        hud.sendMessage({ type: 'accountSwitched', email: payload.email });
        vscode.window.showInformationMessage(t('ws.accountSwitched', { email: payload.email }));
    });
    
    cockpitToolsWs.on('switchError', (payload: { message: string }) => {
        vscode.window.showErrorMessage(t('ws.switchFailed', { message: payload.message }));
    });

    cockpitToolsWs.on('pluginSetSwitchMode', async (payload: PluginSetSwitchModePayload) => {
        const requestId = typeof payload.request_id === 'string' ? payload.request_id : undefined;
        try {
            const requestedMode = normalizeManagedSwitchMode(payload.switch_mode);
            const finishedAt = new Date().toISOString();

            if (!requestedMode) {
                const sent = cockpitToolsWs.sendPluginSetSwitchModeResponse({
                    request_id: requestId,
                    success: false,
                    error_message: `Invalid switch_mode: ${String(payload.switch_mode ?? 'undefined')}`,
                    finished_at: finishedAt,
                });
                if (!sent) {
                    logger.warn(`[WS] Failed to send switch mode failure response: request_id=${requestId ?? 'none'}`);
                }
                return;
            }

            await accountSwitchService.setMode(requestedMode);
            logger.info(`[WS] Applied external switch mode: mode=${requestedMode}, request_id=${requestId ?? 'none'}`);
            const sent = cockpitToolsWs.sendPluginSetSwitchModeResponse({
                request_id: requestId,
                success: true,
                applied_mode: toWsSwitchMode(requestedMode),
                finished_at: finishedAt,
            });
            if (!sent) {
                logger.warn(`[WS] Failed to send switch mode success response: request_id=${requestId ?? 'none'}`);
            }
        } catch (error) {
            const finishedAt = new Date().toISOString();
            const err = error instanceof Error ? error.message : String(error);
            logger.error(`[WS] Failed to process external switch mode request: request_id=${requestId ?? 'none'}, error=${err}`);
            const sent = cockpitToolsWs.sendPluginSetSwitchModeResponse({
                request_id: requestId,
                success: false,
                error_message: err,
                finished_at: finishedAt,
            });
            if (!sent) {
                logger.warn(`[WS] Failed to send switch mode error response: request_id=${requestId ?? 'none'}`);
            }
        }
    });

    cockpitToolsWs.on('pluginSwitchAccount', async (payload: PluginSwitchAccountPayload) => {
        const requestId = typeof payload.request_id === 'string' ? payload.request_id : undefined;
        try {
            const executionRequest: AccountSwitchExecutionRequest = {
                requestId,
                targetEmail: typeof payload.target_email === 'string' ? payload.target_email : '',
                switchMode: normalizeRequestedSwitchMode(payload.switch_mode),
                triggerType: payload.trigger_type === 'auto' ? 'auto' : 'manual',
                triggerSource: typeof payload.trigger_source === 'string' ? payload.trigger_source : 'ws.external',
                reason: typeof payload.reason === 'string' ? payload.reason : '',
                metadata: payload.metadata,
            };

            logger.info(
                `[WS] Executing external account switch: request_id=${requestId ?? 'none'}, target=${executionRequest.targetEmail || 'none'}, mode=${executionRequest.switchMode}, triggerType=${executionRequest.triggerType}, source=${executionRequest.triggerSource ?? 'none'}`,
            );
            const execution = await _messageController.executeAccountSwitch(executionRequest);
            const sent = cockpitToolsWs.sendPluginSwitchAccountResponse({
                execution_id: execution.executionId,
                request_id: execution.requestId,
                success: execution.success,
                effective_mode: toWsSwitchMode(execution.effectiveMode),
                from_email: execution.fromEmail,
                to_email: execution.toEmail,
                duration_ms: execution.durationMs,
                error_code: execution.errorCode,
                error_message: execution.errorMessage,
                finished_at: execution.finishedAt,
            });
            if (!sent) {
                logger.warn(
                    `[WS] Failed to send external switch result: request_id=${execution.requestId ?? 'none'}, execution_id=${execution.executionId}`,
                );
            }
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            const finishedAt = new Date().toISOString();
            const fallbackExecutionId = `switch_${Date.now()}_failed`;
            logger.error(`[WS] External account switch error: request_id=${requestId ?? 'none'}, error=${err}`);
            const sent = cockpitToolsWs.sendPluginSwitchAccountResponse({
                execution_id: fallbackExecutionId,
                request_id: requestId,
                success: false,
                effective_mode: 'default',
                from_email: null,
                to_email: typeof payload.target_email === 'string' ? payload.target_email : '',
                duration_ms: 0,
                error_code: 'unknown',
                error_message: err,
                finished_at: finishedAt,
            });
            if (!sent) {
                logger.warn(`[WS] Failed to send external switch error response: request_id=${requestId ?? 'none'}`);
            }
        }
    });

    cockpitToolsWs.on('languageChanged', async (payload: { language: string; source?: string }) => {
        const language = payload?.language;
        if (!language) {
            return;
        }
        if (payload?.source === 'extension') {
            return;
        }
        const normalizedLanguage = normalizeLocaleInput(language);
        const currentLanguage = normalizeLocaleInput(configService.getConfig().language);
        if (currentLanguage === normalizedLanguage) {
            return;
        }

        logger.info(`[WS] Language synced: ${normalizedLanguage}`);
        await configService.updateConfig('language', normalizedLanguage);
        const localeChanged = i18n.applyLanguageSetting(normalizedLanguage);
        if (localeChanged) {
            hud.dispose();
            setTimeout(() => {
                vscode.commands.executeCommand('agCockpit.open');
            }, 100);
        }
    });

    cockpitToolsWs.on('wakeupOverride', async (payload: { enabled: boolean }) => {
        if (!payload?.enabled) {
            return;
        }
        try {
            const state = await autoTriggerController.getState();
            await autoTriggerController.saveSchedule({
                ...state.schedule,
                enabled: false,
                wakeOnReset: false,
            });
            vscode.window.showInformationMessage(t('ws.wakeupOverride'));
        } catch (err) {
            logger.warn(`[WS] Failed to disable plugin wakeup: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

    context.subscriptions.push(
        configService.onConfigChange(handleConfigChange),
    );

    await bootSystems();

    logger.info('Antigravity Cockpit Fully Operational');
}

function logOfficialAntigravityIdeVersion(): void {
    const ideVersion = getOfficialIdeVersion();
    if (ideVersion) {
        logger.info(`[Startup] Official Antigravity ideVersion: ${ideVersion}`);
    } else {
        logger.warn(`[Startup] Failed to read official ideVersion from ${getOfficialProductJsonPath()}`);
    }

    const officialExtension = vscode.extensions.getExtension(OFFICIAL_ANTIGRAVITY_EXTENSION_ID);
    if (officialExtension) {
        const officialVersion = String(officialExtension.packageJSON?.version ?? 'unknown');
        logger.info(
            `[Startup] Official Antigravity extension: ${officialExtension.id} v${officialVersion} (active=${officialExtension.isActive})`,
        );
    } else {
        logger.warn(`[Startup] Official extension not found: ${OFFICIAL_ANTIGRAVITY_EXTENSION_ID}; version unavailable`);
    }
}

/**
 *
 */
async function handleConfigChange(config: CockpitConfig): Promise<void> {
    logger.debug('Configuration changed', config);

    const currentQuotaSource = config.quotaSource === 'authorized' ? 'authorized' : 'local';
    const quotaSourceChanged = currentQuotaSource !== lastQuotaSource;
    if (quotaSourceChanged) {
        logger.info(`Quota source changed: ${lastQuotaSource} -> ${currentQuotaSource}, skipping reprocess`);
        lastQuotaSource = currentQuotaSource;
    }


    const newInterval = configService.getRefreshIntervalMs();


    if (systemOnline && reactor.currentInterval !== newInterval) {
        logger.info(`Refresh interval changed from ${reactor.currentInterval}ms to ${newInterval}ms. Restarting Reactor.`);
        reactor.startReactor(newInterval);
    }



    if (!quotaSourceChanged) {
        reactor.reprocess();
    }
}

/**
 *
 */
async function bootSystems(): Promise<void> {
    if (systemOnline) {
        return;
    }

    const quotaSource = configService.getConfig().quotaSource;
    if (quotaSource === 'authorized') {
        logger.info('Authorized quota source active, starting reactor with background local scan');
        reactor.startReactor(configService.getRefreshIntervalMs());
        systemOnline = true;
        autoRetryCount = 0;
        statusBar.setLoading();
        hunter.scanEnvironment(1)
            .then(info => {
                if (info) {
                    reactor.engage(info.connectPort, info.csrfToken, hunter.getLastDiagnostics());
                    logger.info('Local Antigravity connection detected in authorized mode');
                }
            })
            .catch(err => {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.debug(`Background local scan skipped: ${error.message}`);
            });
        return;
    }

    statusBar.setLoading();

    try {
        const info = await hunter.scanEnvironment(3);

        if (info) {
            reactor.engage(info.connectPort, info.csrfToken, hunter.getLastDiagnostics());
            reactor.startReactor(configService.getRefreshIntervalMs());
            systemOnline = true;
            autoRetryCount = 0;
            statusBar.setReady();
            logger.info('System boot successful');
        } else {
            if (autoRetryCount < MAX_AUTO_RETRY) {
                autoRetryCount++;
                logger.info(`Auto-retry ${autoRetryCount}/${MAX_AUTO_RETRY} in ${AUTO_RETRY_DELAY_MS / 1000}s...`);
                statusBar.setLoading(`(${autoRetryCount}/${MAX_AUTO_RETRY})`);

                setTimeout(() => {
                    bootSystems();
                }, AUTO_RETRY_DELAY_MS);
            } else {
                autoRetryCount = 0;
                handleOfflineState();
            }
        }
    } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        logger.error('Boot Error', error);

        if (autoRetryCount < MAX_AUTO_RETRY) {
            autoRetryCount++;
            logger.info(`Auto-retry ${autoRetryCount}/${MAX_AUTO_RETRY} after error in ${AUTO_RETRY_DELAY_MS / 1000}s...`);
            statusBar.setLoading(`(${autoRetryCount}/${MAX_AUTO_RETRY})`);

            setTimeout(() => {
                bootSystems();
            }, AUTO_RETRY_DELAY_MS);
        } else {
            autoRetryCount = 0;
            statusBar.setError(error.message);

            vscode.window.showErrorMessage(
                `${t('notify.bootFailed')}: ${error.message}`,
                t('help.retry'),
                t('help.openLogs'),
            ).then(selection => {
                if (selection === t('help.retry')) {
                    vscode.commands.executeCommand('agCockpit.retry');
                } else if (selection === t('help.openLogs')) {
                    logger.show();
                }
            });
        }
    }
}

/**
 *
 */
function handleOfflineState(): void {
    if (configService.getConfig().quotaSource === 'authorized') {
        logger.info('Skipping local offline state due to authorized quota source');
        return;
    }
    statusBar.setOffline();

    vscode.window.showErrorMessage(
        t('notify.offline'),
        t('help.retry'),
        t('help.openLogs'),
    ).then(selection => {
        if (selection === t('help.retry')) {
            vscode.commands.executeCommand('agCockpit.retry');
        } else if (selection === t('help.openLogs')) {
            logger.show();
        }
    });


    hud.refreshView(ReactorCore.createOfflineSnapshot(t('notify.offline')), {
        showPromptCredits: false,
        pinnedModels: [],
        modelOrder: [],
        groupingEnabled: false,
        groupCustomNames: {},
        groupingShowInStatusBar: false,
        pinnedGroups: [],
        groupOrder: [],
        refreshInterval: 120,
        notificationEnabled: false,
        language: configService.getConfig().language,
        quotaSource: 'authorized',
    });
}

/**
 *
 */
export async function deactivate(): Promise<void> {
    logger.info('Antigravity Cockpit: Shutting down...');


    cockpitToolsWs.disconnect();

    reactor?.shutdown();
    hud?.dispose();
    logger.dispose();
}
