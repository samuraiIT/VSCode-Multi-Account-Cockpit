/**
 * Multi-Account Cockpit — Storage Manager Integration
 *
 * Activates backup, sync, profiles, quota, proxy/MCP, Telegram, and diagnostics
 * features ported from antigravity-storage-manager. The new public command space
 * is `multiCockpit.*`, while a legacy compatibility layer keeps the imported
 * upstream modules working on their original IDs and settings namespace.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import extract from 'extract-zip';
import { LocalizationManager } from './l10n/localizationManager';
import { BackupManager } from './backup';
import { ProfileManager } from './profileManager';
import { GoogleAuthProvider } from './googleAuth';
import { SyncConfig, SyncManager } from './sync';
import { resolveConflictsCommand } from './conflicts';
import { DiagnosticsManager } from './diagnostics/diagnosticsManager';
import { QuotaManager } from './quota/quotaManager';
import { TelegramService } from './telegram/telegramService';
import { StatsScheduler } from './telegram/statsScheduler';
import { TelegramCommandController } from './telegram/telegramCommandController';
import { MarkdownExporter } from './markdownExporter';
import { getConversationsAsync } from './utils';
import { ProxyManager } from './proxy/proxyManager';
import { ProxyDashboardWebview } from './proxy/proxyDashboardWebview';

const STORAGE_ROOT = path.join(os.homedir(), '.gemini', 'antigravity');
const BRAIN_DIR = path.join(STORAGE_ROOT, 'brain');
const CONV_DIR = path.join(STORAGE_ROOT, 'conversations');
const CMD = 'multiCockpit';
const LEGACY_CMD = 'antigravity-storage-manager';
const LEGACY_SYNC_CONFIG_KEY = `${LEGACY_CMD}.sync.config`;
const MCP_TERMINAL_NAME = 'Multi-Account Cockpit MCP Server';

let authProvider: GoogleAuthProvider;
let syncManager: SyncManager;
let backupManager: BackupManager;
let quotaManager: QuotaManager;
let diagnosticsManager: DiagnosticsManager;
let profileManager: ProfileManager;
let proxyManager: ProxyManager;
let proxyDashboard: ProxyDashboardWebview;
let telegramService: TelegramService;
let statsScheduler: StatsScheduler;
let telegramCommandController: TelegramCommandController;
let mcpTerminal: vscode.Terminal | undefined;
let isSyncingLegacySettings = false;

export async function activateStorageManager(context: vscode.ExtensionContext): Promise<void> {
    try {
        await syncLegacySettingsFromMultiCockpit(context);

        LocalizationManager.getInstance().initialize(context);
        registerLegacySettingsBridge(context);

        telegramService = new TelegramService(context);

        authProvider = new GoogleAuthProvider(context);
        await authProvider.initialize();

        syncManager = new SyncManager(context, authProvider);
        await syncManager.initialize();
        await applyRuntimeSyncConfigOverrides(context);

        backupManager = new BackupManager(context, STORAGE_ROOT);
        backupManager.initialize();

        quotaManager = new QuotaManager(context, authProvider, telegramService);
        syncManager.setQuotaManager(quotaManager);
        quotaManager.setSyncManager(syncManager);

        statsScheduler = new StatsScheduler(telegramService, quotaManager, syncManager);
        telegramCommandController = new TelegramCommandController(telegramService, quotaManager, syncManager);
        diagnosticsManager = new DiagnosticsManager(authProvider, quotaManager);

        profileManager = new ProfileManager(context);
        await profileManager.initialize();
        quotaManager.setProfileManager(profileManager);

        proxyManager = new ProxyManager(context, STORAGE_ROOT);
        await proxyManager.initialize();
        proxyDashboard = new ProxyDashboardWebview(context.extensionUri, proxyManager, profileManager);

        context.subscriptions.push(
            telegramService,
            statsScheduler,
            telegramCommandController,
            proxyManager,
            {
                dispose: () => {
                    stopMcpServer();
                },
            },
        );

        registerCommands(context);

        const autoStartMcp = vscode.workspace.getConfiguration(CMD).get<boolean>('mcp.enabled', false);
        if (autoStartMcp) {
            void runMcpServer(context);
        }
    } catch (err) {
        console.error('[MultiCockpit] Storage manager activation error:', err);
    }
}

function registerLegacySettingsBridge(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (
                event.affectsConfiguration(`${CMD}.backup`)
                || event.affectsConfiguration(`${CMD}.sync`)
                || event.affectsConfiguration(`${CMD}.telegram`)
                || event.affectsConfiguration(`${CMD}.mcp`)
                || event.affectsConfiguration(`${CMD}.profiles`)
            ) {
                await syncLegacySettingsFromMultiCockpit(context);
                await applyRuntimeSyncConfigOverrides(context);

                if (event.affectsConfiguration(`${CMD}.mcp.enabled`)) {
                    const enabled = vscode.workspace.getConfiguration(CMD).get<boolean>('mcp.enabled', false);
                    if (enabled) {
                        await runMcpServer(context);
                    } else {
                        stopMcpServer();
                    }
                }
            }
        }),
    );
}

async function syncLegacySettingsFromMultiCockpit(context: vscode.ExtensionContext): Promise<void> {
    if (isSyncingLegacySettings) {
        return;
    }

    isSyncingLegacySettings = true;
    try {
        const multiConfig = vscode.workspace.getConfiguration(CMD);
        const legacyConfig = vscode.workspace.getConfiguration(LEGACY_CMD);

        await setLegacySetting(legacyConfig, 'backup.enabled', multiConfig.get<boolean>('backup.autoBackup', true));
        await setLegacySetting(legacyConfig, 'backup.retentionDays', multiConfig.get<number>('backup.retentionDays', 30));
        await setLegacySetting(legacyConfig, 'sync.enabled', multiConfig.get<boolean>('sync.enabled', false));
        await setLegacySetting(legacyConfig, 'sync.autoSync', multiConfig.get<boolean>('sync.autoSync', true));
        await setLegacySetting(legacyConfig, 'sync.intervalMs', multiConfig.get<number>('sync.intervalMs', 300000));
        await setLegacySetting(legacyConfig, 'telegram.enabled', multiConfig.get<boolean>('telegram.enabled', false));
        await setLegacySetting(legacyConfig, 'telegram.botToken', multiConfig.get<string>('telegram.botToken', ''));

        const chatId = multiConfig.get<string>('telegram.chatId', '').trim();
        await setLegacySetting(legacyConfig, 'telegram.userIds', chatId ? [chatId] : []);
        await setLegacySetting(legacyConfig, 'profilesDirectory', multiConfig.get<string>('profiles.directory', ''));
        await setLegacySetting(legacyConfig, 'mcp.autoStart', multiConfig.get<boolean>('mcp.enabled', false));

        const storedSyncConfig = context.globalState.get<SyncConfig>(LEGACY_SYNC_CONFIG_KEY);
        if (storedSyncConfig) {
            const updatedSyncConfig: SyncConfig = {
                ...storedSyncConfig,
                enabled: multiConfig.get<boolean>('sync.enabled', storedSyncConfig.enabled),
                autoSync: multiConfig.get<boolean>('sync.autoSync', storedSyncConfig.autoSync),
                syncInterval: multiConfig.get<number>('sync.intervalMs', storedSyncConfig.syncInterval),
            };

            if (JSON.stringify(updatedSyncConfig) !== JSON.stringify(storedSyncConfig)) {
                await context.globalState.update(LEGACY_SYNC_CONFIG_KEY, updatedSyncConfig);
            }
        }
    } finally {
        isSyncingLegacySettings = false;
    }
}

async function setLegacySetting<T>(
    legacyConfig: vscode.WorkspaceConfiguration,
    key: string,
    value: T,
): Promise<void> {
    const currentValue = legacyConfig.get<T>(key);
    if (JSON.stringify(currentValue) === JSON.stringify(value)) {
        return;
    }
    await legacyConfig.update(key, value, vscode.ConfigurationTarget.Global);
}

async function applyRuntimeSyncConfigOverrides(context: vscode.ExtensionContext): Promise<void> {
    if (!syncManager) {
        return;
    }

    const syncConfig = syncManager.getConfig();
    if (!syncConfig) {
        return;
    }

    const multiConfig = vscode.workspace.getConfiguration(CMD);
    syncConfig.enabled = multiConfig.get<boolean>('sync.enabled', syncConfig.enabled);
    syncConfig.autoSync = multiConfig.get<boolean>('sync.autoSync', syncConfig.autoSync);
    syncConfig.syncInterval = multiConfig.get<number>('sync.intervalMs', syncConfig.syncInterval);

    await context.globalState.update(LEGACY_SYNC_CONFIG_KEY, syncConfig);

    if (!syncConfig.enabled || !syncConfig.autoSync || !syncManager.isReady()) {
        syncManager.stopAutoSync();
        return;
    }

    syncManager.startAutoSync();
}

function registerCommands(context: vscode.ExtensionContext) {
    const disposables: vscode.Disposable[] = [
        vscode.commands.registerCommand(`${CMD}.backup`, async () => {
            await backupAll();
        }),
        vscode.commands.registerCommand(`${CMD}.restore`, async () => {
            await importConversations();
        }),
        vscode.commands.registerCommand(`${CMD}.exportMarkdown`, async () => {
            const conversations = await getConversationsAsync(BRAIN_DIR);
            if (conversations.length === 0) {
                vscode.window.showInformationMessage('No conversations found to export.');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                conversations.map((conversation) => ({
                    label: conversation.label,
                    description: conversation.id,
                    conv: conversation,
                })),
                {
                    placeHolder: 'Select conversations to export as Markdown',
                    canPickMany: true,
                },
            );

            if (!selected || selected.length === 0) {
                return;
            }

            const folder = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                openLabel: 'Export Here',
            });

            if (!folder?.[0]) {
                return;
            }

            const result = await MarkdownExporter.exportMultiple(
                selected.map((item) => item.conv),
                folder[0].fsPath,
            );

            vscode.window.showInformationMessage(
                `Exported ${result.exported} conversation(s).${result.errors.length > 0 ? ` ${result.errors.length} error(s).` : ''}`,
            );
        }),
        vscode.commands.registerCommand(`${CMD}.importConversations`, async () => {
            await importConversations();
        }),
        vscode.commands.registerCommand(`${CMD}.syncSetup`, async () => {
            await syncManager.setup();
        }),
        vscode.commands.registerCommand(`${CMD}.syncNow`, async () => {
            if (!syncManager.isReady()) {
                const button = await vscode.window.showWarningMessage(
                    'Google Drive sync is not configured. Setup now?',
                    'Setup',
                );
                if (button === 'Setup') {
                    await syncManager.setup();
                }
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Multi-Account Cockpit: Syncing with Google Drive…',
                cancellable: true,
            }, async (progress, token) => {
                await syncManager.syncNow(progress, token);
            });
        }),
        vscode.commands.registerCommand(`${CMD}.switchProfile`, async () => {
            await profileManager.showProfilePicker();
        }),
        vscode.commands.registerCommand(`${CMD}.saveProfile`, async () => {
            await profileManager.promptForSaveProfile();
        }),
        vscode.commands.registerCommand(`${CMD}.deleteProfile`, async () => {
            const profiles = await profileManager.loadProfiles();
            if (profiles.length === 0) {
                vscode.window.showInformationMessage('No profiles found.');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                profiles.map((profile) => ({ label: profile.name, profile })),
                { placeHolder: 'Select profile to delete' },
            );

            if (!selected) {
                return;
            }

            await profileManager.deleteProfile(selected.label);
            vscode.window.showInformationMessage(`Profile '${selected.label}' deleted.`);
        }),
        vscode.commands.registerCommand(`${CMD}.resolveConflicts`, async () => {
            await resolveConflictsCommand(BRAIN_DIR, CONV_DIR);
        }),
        vscode.commands.registerCommand(`${CMD}.showDiagnostics`, async () => {
            await showDiagnosticsReport();
        }),
        vscode.commands.registerCommand(`${CMD}.startMcpServer`, async () => {
            await runMcpServer(context);
        }),
        vscode.commands.registerCommand(`${CMD}.stopMcpServer`, async () => {
            stopMcpServer();
        }),
        vscode.commands.registerCommand(`${CMD}.telegramSetup`, async () => {
            const botToken = await vscode.window.showInputBox({
                prompt: 'Enter your Telegram Bot Token',
                placeHolder: '1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ',
                password: true,
            });
            if (!botToken) {
                return;
            }

            const chatId = await vscode.window.showInputBox({
                prompt: 'Enter your Telegram Chat ID',
                placeHolder: '123456789',
            });
            if (!chatId) {
                return;
            }

            const config = vscode.workspace.getConfiguration(CMD);
            await config.update('telegram.botToken', botToken, vscode.ConfigurationTarget.Global);
            await config.update('telegram.chatId', chatId, vscode.ConfigurationTarget.Global);
            await config.update('telegram.enabled', true, vscode.ConfigurationTarget.Global);

            await syncLegacySettingsFromMultiCockpit(context);
            vscode.window.showInformationMessage('Telegram bot configured. Restart VS Code to apply.');
        }),

        // Hidden compatibility commands used by imported upstream UI modules.
        vscode.commands.registerCommand(`${CMD}.showQuota`, async () => quotaManager.showQuota()),
        vscode.commands.registerCommand(`${CMD}.showAccountData`, async () => quotaManager.showAccountData()),
        vscode.commands.registerCommand(`${CMD}.syncManage`, async () => syncManager.manageConversations()),
        vscode.commands.registerCommand(`${CMD}.syncManageAuthorizedMachines`, async () => syncManager.manageAuthorizedMachines()),
        vscode.commands.registerCommand(`${CMD}.syncDisconnect`, async () => syncManager.disconnect()),
        vscode.commands.registerCommand(`${CMD}.reindexConversations`, async () => syncManager.reindexConversations()),
        vscode.commands.registerCommand(`${CMD}.showSyncStats`, async () => syncManager.showStatistics()),
        vscode.commands.registerCommand(`${CMD}.addAccount`, async () => authProvider.addAccount()),
        vscode.commands.registerCommand(`${CMD}.switchAccount`, async (accountId: string) => authProvider.switchAccount(accountId)),
        vscode.commands.registerCommand(`${CMD}.removeAccount`, async (accountId: string) => authProvider.removeAccount(accountId)),
        vscode.commands.registerCommand(`${CMD}.proxyDashboard`, () => proxyDashboard.show()),
        vscode.commands.registerCommand(`${CMD}.proxyStart`, async () => proxyManager.start()),
        vscode.commands.registerCommand(`${CMD}.proxyStop`, async () => proxyManager.stop()),
        vscode.commands.registerCommand(`${CMD}.proxyInstall`, async () => proxyManager.install()),

        // Legacy command aliases required by ported antigravity-storage-manager internals.
        vscode.commands.registerCommand(`${LEGACY_CMD}.import`, async () => importConversations()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.exportAsMarkdown`, async () => vscode.commands.executeCommand(`${CMD}.exportMarkdown`)),
        vscode.commands.registerCommand(`${LEGACY_CMD}.backupAll`, async () => backupAll()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.resolveConflicts`, async () => resolveConflictsCommand(BRAIN_DIR, CONV_DIR)),
        vscode.commands.registerCommand(`${LEGACY_CMD}.syncSetup`, async () => syncManager.setup()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.syncNow`, async () => vscode.commands.executeCommand(`${CMD}.syncNow`)),
        vscode.commands.registerCommand(`${LEGACY_CMD}.showQuota`, async () => quotaManager.showQuota()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.showAccountData`, async () => quotaManager.showAccountData()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.syncManage`, async () => syncManager.manageConversations()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.syncManageAuthorizedMachines`, async () => syncManager.manageAuthorizedMachines()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.syncDisconnect`, async () => syncManager.disconnect()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.reindexConversations`, async () => syncManager.reindexConversations()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.showSyncStats`, async () => syncManager.showStatistics()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.showDiagnostics`, async () => showDiagnosticsReport()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.runDiagnostics`, async () => showDiagnosticsReport()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.switchProfile`, async () => profileManager.showProfilePicker()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.saveProfile`, async () => profileManager.promptForSaveProfile()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.deleteProfile`, async () => vscode.commands.executeCommand(`${CMD}.deleteProfile`)),
        vscode.commands.registerCommand(`${LEGACY_CMD}.proxy.dashboard`, () => proxyDashboard.show()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.statusAction`, () => {
            proxyDashboard.show();
            proxyManager.showLog();
        }),
        vscode.commands.registerCommand(`${LEGACY_CMD}.proxy.start`, async () => proxyManager.start()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.proxy.stop`, async () => proxyManager.stop()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.proxy.install`, async () => proxyManager.install()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.addAccount`, async () => authProvider.addAccount()),
        vscode.commands.registerCommand(`${LEGACY_CMD}.switchAccount`, async (accountId: string) => authProvider.switchAccount(accountId)),
        vscode.commands.registerCommand(`${LEGACY_CMD}.removeAccount`, async (accountId: string) => authProvider.removeAccount(accountId)),
    ];

    context.subscriptions.push(...disposables);
}

async function backupAll() {
    const lm = LocalizationManager.getInstance();
    const conversations = await getConversationsAsync(BRAIN_DIR);
    if (conversations.length === 0) {
        vscode.window.showInformationMessage(lm.t('No conversations found to backup.'));
        return;
    }

    const defaultName = `multi-account-cockpit-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    const destination = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), defaultName)),
        filters: { 'ZIP Archive': ['zip'] },
        saveLabel: lm.t('Create Backup'),
    });

    if (!destination) {
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: lm.t('Backing up {0} conversations...', conversations.length),
        cancellable: true,
    }, async (_progress, token) => {
        try {
            const filePath = await backupManager.backupNow(destination.fsPath, token);
            const fileStats = fs.statSync(filePath);
            const sizeMb = (fileStats.size / 1024 / 1024).toFixed(2);

            const action = await vscode.window.showInformationMessage(
                lm.t('Backup complete! ({0} MB)', sizeMb),
                lm.t('Show in Folder'),
            );

            if (action === lm.t('Show in Folder')) {
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
            }
        } catch (error: any) {
            if (!(error instanceof vscode.CancellationError)) {
                vscode.window.showErrorMessage(lm.t('Backup failed: {0}', error.message));
            }
        }
    });
}

function removePathIfExists(targetPath: string) {
    if (!fs.existsSync(targetPath)) {
        return;
    }

    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
        return;
    }

    fs.rmSync(targetPath, { force: true });
}

function createImportWorkspacePath(parentDir: string, label: string): string {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return path.join(parentDir, `${label}.${suffix}`);
}

function replaceImportedConversationFiles(
    sourceBrainDir: string,
    sourcePbFile: string,
    targetConversationId: string,
) {
    fs.mkdirSync(BRAIN_DIR, { recursive: true });

    const targetBrainDir = path.join(BRAIN_DIR, targetConversationId);
    const targetPbFile = path.join(CONV_DIR, `${targetConversationId}.pb`);
    const hasSourcePbFile = fs.existsSync(sourcePbFile);

    const stagedBrainDir = createImportWorkspacePath(BRAIN_DIR, `.import-staging-${targetConversationId}`);
    const stagedPbFile = hasSourcePbFile
        ? createImportWorkspacePath(CONV_DIR, `.import-staging-${targetConversationId}.pb`)
        : null;

    const existingBrainBackupDir = fs.existsSync(targetBrainDir)
        ? createImportWorkspacePath(BRAIN_DIR, `.import-backup-${targetConversationId}`)
        : null;
    const existingPbBackupFile = fs.existsSync(targetPbFile)
        ? createImportWorkspacePath(CONV_DIR, `.import-backup-${targetConversationId}.pb`)
        : null;

    fs.cpSync(sourceBrainDir, stagedBrainDir, { recursive: true });
    if (stagedPbFile) {
        fs.mkdirSync(CONV_DIR, { recursive: true });
        fs.copyFileSync(sourcePbFile, stagedPbFile);
    }

    try {
        if (existingBrainBackupDir) {
            fs.renameSync(targetBrainDir, existingBrainBackupDir);
        }
        if (existingPbBackupFile) {
            fs.mkdirSync(CONV_DIR, { recursive: true });
            fs.renameSync(targetPbFile, existingPbBackupFile);
        }

        fs.renameSync(stagedBrainDir, targetBrainDir);

        if (stagedPbFile) {
            fs.mkdirSync(CONV_DIR, { recursive: true });
            fs.renameSync(stagedPbFile, targetPbFile);
        }

        if (existingBrainBackupDir) {
            fs.rmSync(existingBrainBackupDir, { recursive: true, force: true });
        }
        if (existingPbBackupFile) {
            fs.rmSync(existingPbBackupFile, { force: true });
        }
    } catch (error) {
        removePathIfExists(targetBrainDir);
        removePathIfExists(targetPbFile);

        if (existingBrainBackupDir && fs.existsSync(existingBrainBackupDir)) {
            fs.renameSync(existingBrainBackupDir, targetBrainDir);
        }
        if (existingPbBackupFile && fs.existsSync(existingPbBackupFile)) {
            fs.mkdirSync(CONV_DIR, { recursive: true });
            fs.renameSync(existingPbBackupFile, targetPbFile);
        }

        removePathIfExists(stagedBrainDir);
        if (stagedPbFile) {
            removePathIfExists(stagedPbFile);
        }

        throw error;
    }
}

async function importConversations() {
    const lm = LocalizationManager.getInstance();
    const archives = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: true,
        filters: { 'ZIP Archive': ['zip'] },
        openLabel: lm.t('Import'),
    });

    if (!archives || archives.length === 0) {
        return;
    }

    let importedCount = 0;
    let skippedCount = 0;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: lm.t('Importing {0} archive(s)...', archives.length),
        cancellable: true,
    }, async (progress, token) => {
        for (const archive of archives) {
            if (token.isCancellationRequested) {
                break;
            }

            const zipPath = archive.fsPath;
            progress.report({ message: path.basename(zipPath) });

            try {
                const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-cockpit-import-'));

                try {
                    await extract(zipPath, { dir: tempDir });
                    const extractedBrainDir = path.join(tempDir, 'brain');
                    if (!fs.existsSync(extractedBrainDir)) {
                        continue;
                    }

                    const conversationIds = fs.readdirSync(extractedBrainDir).filter((entry) =>
                        fs.statSync(path.join(extractedBrainDir, entry)).isDirectory(),
                    );

                    for (const conversationId of conversationIds) {
                        const existingConversationDir = path.join(BRAIN_DIR, conversationId);
                        let targetConversationId = conversationId;

                        if (fs.existsSync(existingConversationDir)) {
                            const choice = await vscode.window.showWarningMessage(
                                lm.t('Conversation "{0}" already exists.', conversationId),
                                { modal: true },
                                lm.t('Overwrite'),
                                lm.t('Rename'),
                                lm.t('Skip'),
                            );

                            if (choice === lm.t('Skip') || !choice) {
                                skippedCount++;
                                continue;
                            }

                            if (choice === lm.t('Rename')) {
                                const newConversationId = await vscode.window.showInputBox({
                                    prompt: lm.t('Enter new conversation ID'),
                                    value: `${conversationId}-imported`,
                                    validateInput: (value) => {
                                        if (!value) {
                                            return lm.t('ID cannot be empty');
                                        }
                                        if (fs.existsSync(path.join(BRAIN_DIR, value))) {
                                            return lm.t('This ID already exists');
                                        }
                                        return null;
                                    },
                                });

                                if (!newConversationId) {
                                    skippedCount++;
                                    continue;
                                }

                                targetConversationId = newConversationId;
                            }
                        }

                        const sourceBrainDir = path.join(extractedBrainDir, conversationId);
                        const sourcePbFile = path.join(tempDir, 'conversations', `${conversationId}.pb`);
                        replaceImportedConversationFiles(sourceBrainDir, sourcePbFile, targetConversationId);

                        importedCount++;
                    }
                } finally {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(lm.t('Failed to import {0}: {1}', path.basename(zipPath), error.message));
            }
        }
    });

    if (importedCount > 0) {
        try {
            await syncManager.reindexConversations();
        } catch (error: any) {
            console.warn('[MultiCockpit][Import] Reindex after import failed:', error.message);
        }
    }

    const summary = lm.t('Imported {0} conversation(s)', importedCount)
        + (skippedCount > 0 ? lm.t(', skipped {0}', skippedCount) : '');
    const action = await vscode.window.showInformationMessage(
        lm.t('{0}. Reload window to refresh?', summary),
        lm.t('Reload'),
        lm.t('Later'),
    );

    if (action === lm.t('Reload')) {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

async function showDiagnosticsReport() {
    const results = await diagnosticsManager.runDiagnostics();
    const output = vscode.window.createOutputChannel('Multi-Account Cockpit Diagnostics');
    output.clear();
    output.appendLine('=== Multi-Account Cockpit Diagnostics ===');
    output.appendLine(`Run at: ${new Date().toLocaleString()}`);
    output.appendLine('');

    for (const result of results) {
        output.appendLine(`${result.success ? 'OK' : 'FAIL'} ${result.name}: ${result.message}`);
    }

    output.show();
}

async function runMcpServer(context: vscode.ExtensionContext) {
    if (!proxyManager) {
        vscode.window.showErrorMessage('Proxy manager is not initialized yet.');
        return;
    }

    if (mcpTerminal) {
        mcpTerminal.dispose();
        mcpTerminal = undefined;
    }

    for (const terminal of vscode.window.terminals) {
        if (terminal.name === MCP_TERMINAL_NAME) {
            terminal.dispose();
        }
    }

    const deployedScriptPath = await proxyManager.deployMcpServerScript(context.extensionUri);
    const apiKeys = proxyManager.getApiKeys();
    const apiKey = apiKeys.length > 0 ? apiKeys[0].key : '';
    const managementKey = await proxyManager.getManagementKey();
    const multiConfig = vscode.workspace.getConfiguration(CMD);
    const mcpPortInspect = multiConfig.inspect<number>('mcp.port');
    const explicitMcpPort = mcpPortInspect?.workspaceValue ?? mcpPortInspect?.globalValue;
    const proxyPort = typeof explicitMcpPort === 'number'
        ? explicitMcpPort
        : vscode.workspace.getConfiguration(LEGACY_CMD).get<number>('proxy.port', 8317);
    const proxyBinDir = path.join(STORAGE_ROOT, 'bin');

    const terminalEnv: Record<string, string> = {
        PROXY_PORT: String(proxyPort),
        PROXY_BIN_DIR: proxyBinDir,
        PROXY_API_KEY: apiKey,
    };
    if (managementKey) {
        terminalEnv.PROXY_MANAGEMENT_KEY = managementKey;
    }

    mcpTerminal = vscode.window.createTerminal({
        name: MCP_TERMINAL_NAME,
        env: terminalEnv,
    });
    mcpTerminal.sendText(`node "${deployedScriptPath}"`);

    mcpTerminal.show();
}

function stopMcpServer() {
    if (mcpTerminal) {
        mcpTerminal.dispose();
        mcpTerminal = undefined;
    }
}
