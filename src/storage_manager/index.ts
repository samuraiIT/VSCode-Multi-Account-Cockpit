/**
 * Multi-Account Cockpit — Storage Manager Integration
 *
 * Activates backup, sync, profile, Telegram, and diagnostics features
 * ported from antigravity-storage-manager. Commands registered under `multiCockpit.*`.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { LocalizationManager } from './l10n/localizationManager';
import { BackupManager } from './backup';
import { ProfileManager } from './profileManager';
import { GoogleAuthProvider } from './googleAuth';
import { SyncManager } from './sync';
import { resolveConflictsCommand } from './conflicts';
import { DiagnosticsManager } from './diagnostics/diagnosticsManager';
import { QuotaManager } from './quota/quotaManager';
import { TelegramService } from './telegram/telegramService';
import { StatsScheduler } from './telegram/statsScheduler';
import { TelegramCommandController } from './telegram/telegramCommandController';
import { MarkdownExporter } from './markdownExporter';
import { getConversationsAsync } from './utils';

const STORAGE_ROOT = path.join(os.homedir(), '.gemini', 'antigravity');
const BRAIN_DIR = path.join(STORAGE_ROOT, 'brain');
const CONV_DIR = path.join(STORAGE_ROOT, 'conversations');
const CMD = 'multiCockpit';

let authProvider: GoogleAuthProvider;
let syncManager: SyncManager;
let backupManager: BackupManager;
let quotaManager: QuotaManager;
let diagnosticsManager: DiagnosticsManager;
let profileManager: ProfileManager;
let telegramService: TelegramService;
let statsScheduler: StatsScheduler;
let telegramCommandController: TelegramCommandController;

export async function activateStorageManager(context: vscode.ExtensionContext): Promise<void> {
    try {
        LocalizationManager.getInstance().initialize(context);

        telegramService = new TelegramService(context);
        authProvider = new GoogleAuthProvider(context);
        await authProvider.initialize();

        syncManager = new SyncManager(context, authProvider);
        await syncManager.initialize();

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

        context.subscriptions.push(telegramService, statsScheduler, telegramCommandController);

        registerCommands(context);
    } catch (err) {
        console.error('[MultiCockpit] Storage manager activation error:', err);
    }
}

function registerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        // ── Backup ──────────────────────────────────────────────────────────
        vscode.commands.registerCommand(`${CMD}.backup`, async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Multi-Account Cockpit: Backing up conversations…',
                cancellable: false,
            }, async () => {
                const dest = await backupManager.backupNow();
                const btn = await vscode.window.showInformationMessage(
                    `Backup created: ${dest}`,
                    'Show in Folder',
                );
                if (btn === 'Show in Folder') {
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dest));
                }
            });
        }),

        // ── Export Markdown ──────────────────────────────────────────────────
        vscode.commands.registerCommand(`${CMD}.exportMarkdown`, async () => {
            const conversations = await getConversationsAsync(CONV_DIR);
            if (conversations.length === 0) {
                vscode.window.showInformationMessage('No conversations found to export.');
                return;
            }
            const items = conversations.map(c => ({
                label: c.title || c.id,
                description: c.id,
                conv: c,
            }));
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select conversations to export as Markdown',
                canPickMany: true,
            });
            if (!selected || selected.length === 0) { return; }
            const folder = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                openLabel: 'Export Here',
            });
            if (folder && folder[0]) {
                const result = await MarkdownExporter.exportMultiple(
                    selected.map(s => s.conv),
                    folder[0].fsPath,
                );
                vscode.window.showInformationMessage(
                    `Exported ${result.exported} conversation(s).${result.errors.length > 0 ? ` ${result.errors.length} error(s).` : ''}`,
                );
            }
        }),

        // ── Sync ─────────────────────────────────────────────────────────────
        vscode.commands.registerCommand(`${CMD}.syncSetup`, async () => {
            await syncManager.setup();
        }),

        vscode.commands.registerCommand(`${CMD}.syncNow`, async () => {
            if (!syncManager.isReady()) {
                const btn = await vscode.window.showWarningMessage(
                    'Google Drive sync is not configured. Setup now?',
                    'Setup',
                );
                if (btn === 'Setup') {
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

        // ── Profile Management ────────────────────────────────────────────────
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
                profiles.map(p => ({ label: p.name, profile: p })),
                { placeHolder: 'Select profile to delete' },
            );
            if (selected) {
                await profileManager.deleteProfile(selected.label);
                vscode.window.showInformationMessage(`Profile '${selected.label}' deleted.`);
            }
        }),

        // ── Conflicts ─────────────────────────────────────────────────────────
        vscode.commands.registerCommand(`${CMD}.resolveConflicts`, async () => {
            await resolveConflictsCommand(BRAIN_DIR, CONV_DIR);
        }),

        // ── Diagnostics ───────────────────────────────────────────────────────
        vscode.commands.registerCommand(`${CMD}.showDiagnostics`, async () => {
            const results = await diagnosticsManager.runDiagnostics();
            const lines = results.map(r => `${r.success ? '✅' : '❌'} ${r.name}: ${r.message}`);
            const panel = vscode.window.createOutputChannel('Multi-Account Cockpit Diagnostics');
            panel.clear();
            panel.appendLine('=== Multi-Account Cockpit Diagnostics ===');
            panel.appendLine(`Run at: ${new Date().toLocaleString()}`);
            panel.appendLine('');
            lines.forEach(l => panel.appendLine(l));
            panel.show();
        }),

        // ── Telegram ──────────────────────────────────────────────────────────
        vscode.commands.registerCommand(`${CMD}.telegramSetup`, async () => {
            const botToken = await vscode.window.showInputBox({
                prompt: 'Enter your Telegram Bot Token',
                placeHolder: '1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ',
                password: true,
            });
            if (!botToken) { return; }
            const chatId = await vscode.window.showInputBox({
                prompt: 'Enter your Telegram Chat ID',
                placeHolder: '123456789',
            });
            if (!chatId) { return; }
            const config = vscode.workspace.getConfiguration('multiCockpit.telegram');
            await config.update('botToken', botToken, vscode.ConfigurationTarget.Global);
            await config.update('chatId', chatId, vscode.ConfigurationTarget.Global);
            await config.update('enabled', true, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Telegram bot configured. Restart VS Code to apply.');
        }),
    );
}
