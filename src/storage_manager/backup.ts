import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { LocalizationManager } from './l10n/localizationManager';

const LEGACY_EXT_NAME = 'antigravity-storage-manager';
const CONFIG_ROOT = 'multiCockpit';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class BackupManager {
    private storageRoot: string;
    private brainDir: string;
    private convDir: string;
    private timer: NodeJS.Timeout | undefined;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext, storageRoot: string) {
        this.context = context;
        this.storageRoot = storageRoot;
        this.brainDir = path.join(storageRoot, 'brain');
        this.convDir = path.join(storageRoot, 'conversations');
    }

    initialize() {
        setTimeout(() => this.checkAndSchedule(), 10000);

        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration(`${CONFIG_ROOT}.backup`)
                    || event.affectsConfiguration(`${LEGACY_EXT_NAME}.backup`)
                ) {
                    this.checkAndSchedule();
                }
            }),
        );
    }

    private checkAndSchedule() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }

        const enabled = vscode.workspace.getConfiguration(CONFIG_ROOT).get<boolean>('backup.autoBackup', true);
        if (!enabled) {
            console.log('Multi-Account Cockpit Backups: Disabled');
            return;
        }

        const legacyBackupConfig = vscode.workspace.getConfiguration(`${LEGACY_EXT_NAME}.backup`);
        const intervalHours = legacyBackupConfig.get<number>('interval', 24);
        const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;

        console.log(`Multi-Account Cockpit Backups: Enabled. Interval: ${intervalHours}h`);

        this.timer = setInterval(() => {
            void this.performScheduledBackup();
        }, intervalMs);

        void this.checkLastBackupTime(intervalMs);
    }

    private async checkLastBackupTime(intervalMs: number) {
        const lastBackupTime = this.context.globalState.get<string>('lastBackupTime');
        const now = Date.now();

        if (!lastBackupTime || (now - new Date(lastBackupTime).getTime() > intervalMs)) {
            await this.performScheduledBackup();
        }
    }

    private async performScheduledBackup() {
        try {
            await this.backupNow();
        } catch (error: unknown) {
            const lm = LocalizationManager.getInstance();
            vscode.window.showErrorMessage(lm.t('Scheduled backup failed: {0}', getErrorMessage(error)));
        }
    }

    async backupNow(targetPath?: string, token?: vscode.CancellationToken): Promise<string> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        const resolvedTarget = this.resolveBackupTarget(targetPath);
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        await this.createZip(resolvedTarget.filePath, token);

        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        await this.context.globalState.update('lastBackupTime', new Date().toISOString());
        if (resolvedTarget.shouldApplyRetentionCleanup) {
            await this.cleanOldBackups(resolvedTarget.directoryPath);
        }

        return resolvedTarget.filePath;
    }

    private resolveBackupTarget(targetPath?: string): {
        directoryPath: string;
        filePath: string;
        shouldApplyRetentionCleanup: boolean;
    } {
        const legacyBackupConfig = vscode.workspace.getConfiguration(`${LEGACY_EXT_NAME}.backup`);
        const configuredPath = legacyBackupConfig.get<string>('path');
        const defaultDirectory = configuredPath && configuredPath.trim().length > 0
            ? configuredPath
            : path.join(this.storageRoot, 'backups');

        if (!targetPath || targetPath.trim().length === 0) {
            fs.mkdirSync(defaultDirectory, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            return {
                directoryPath: defaultDirectory,
                filePath: path.join(defaultDirectory, `backup-${timestamp}.zip`),
                shouldApplyRetentionCleanup: true,
            };
        }

        const normalizedTarget = path.resolve(targetPath);
        const looksLikeZipFile = normalizedTarget.toLowerCase().endsWith('.zip');

        if (looksLikeZipFile) {
            const directoryPath = path.dirname(normalizedTarget);
            fs.mkdirSync(directoryPath, { recursive: true });
            return {
                directoryPath,
                filePath: normalizedTarget,
                shouldApplyRetentionCleanup: false,
            };
        }

        fs.mkdirSync(normalizedTarget, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return {
            directoryPath: normalizedTarget,
            filePath: path.join(normalizedTarget, `backup-${timestamp}.zip`),
            shouldApplyRetentionCleanup: false,
        };
    }

    private createZip(zipPath: string, token?: vscode.CancellationToken): Promise<void> {
        if (token?.isCancellationRequested) {
            return Promise.reject(new vscode.CancellationError());
        }

        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            if (token) {
                token.onCancellationRequested(() => {
                    archive.abort();
                    output.close();
                    fs.unlink(zipPath, () => { });
                    reject(new vscode.CancellationError());
                });
            }

            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);

            if (fs.existsSync(this.brainDir)) {
                archive.directory(this.brainDir, 'brain');
            }
            if (fs.existsSync(this.convDir)) {
                archive.directory(this.convDir, 'conversations');
            }

            void archive.finalize();
        });
    }

    private async cleanOldBackups(backupDir: string) {
        const retentionDays = vscode.workspace.getConfiguration(CONFIG_ROOT).get<number>('backup.retentionDays', 30);
        if (!retentionDays || retentionDays <= 0 || !fs.existsSync(backupDir)) {
            return;
        }

        try {
            const cutoffMs = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
            const files = fs.readdirSync(backupDir)
                .filter((file) => file.toLowerCase().endsWith('.zip'))
                .map((file) => ({
                    path: path.join(backupDir, file),
                    modifiedAt: fs.statSync(path.join(backupDir, file)).mtime.getTime(),
                }))
                .filter((file) => file.modifiedAt < cutoffMs);

            for (const file of files) {
                fs.unlinkSync(file.path);
                console.log(`Deleted expired backup: ${path.basename(file.path)}`);
            }
        } catch (error: unknown) {
            const lm = LocalizationManager.getInstance();
            vscode.window.showErrorMessage(lm.t('Failed to clean old backups: {0}', getErrorMessage(error)));
        }
    }
}
