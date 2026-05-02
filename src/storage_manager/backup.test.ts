import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BackupManager } from './backup';

jest.mock('archiver', () => () => ({
    on: jest.fn(),
    pipe: jest.fn(),
    directory: jest.fn(),
    abort: jest.fn(),
    finalize: jest.fn(),
}));

function createContext() {
    return {
        subscriptions: [],
        globalState: {
            get: jest.fn(),
            update: jest.fn(),
        },
    } as unknown as vscode.ExtensionContext;
}

type BackupManagerInternals = {
    resolveBackupTarget: (targetPath?: string) => {
        directoryPath: string;
        filePath: string;
        shouldApplyRetentionCleanup: boolean;
    };
    cleanOldBackups: (backupDir: string) => Promise<void>;
};

describe('BackupManager', () => {
    let tempRoot: string;
    let multiConfigGet: jest.Mock;
    let legacyConfigGet: jest.Mock;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-manager-'));
        multiConfigGet = jest.fn();
        legacyConfigGet = jest.fn();

        jest.spyOn(vscode.workspace, 'getConfiguration').mockImplementation((section?: string) => {
            if (section === 'multiCockpit') {
                return {
                    get: multiConfigGet,
                    update: jest.fn(),
                } as unknown as vscode.WorkspaceConfiguration;
            }

            if (section === 'antigravity-storage-manager.backup') {
                return {
                    get: legacyConfigGet,
                    update: jest.fn(),
                } as unknown as vscode.WorkspaceConfiguration;
            }

            return {
                get: jest.fn(),
                update: jest.fn(),
            } as unknown as vscode.WorkspaceConfiguration;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('resolves default backup targets from the configured legacy backup path', () => {
        const configuredDir = path.join(tempRoot, 'configured-backups');
        legacyConfigGet.mockImplementation((key: string, fallback?: unknown) => {
            if (key === 'path') {
                return configuredDir;
            }
            return fallback;
        });

        const manager = new BackupManager(createContext(), tempRoot);
        const target = (manager as unknown as BackupManagerInternals).resolveBackupTarget();

        expect(target.directoryPath).toBe(configuredDir);
        expect(target.filePath.startsWith(configuredDir)).toBe(true);
        expect(target.filePath.endsWith('.zip')).toBe(true);
        expect(target.shouldApplyRetentionCleanup).toBe(true);
        expect(fs.existsSync(configuredDir)).toBe(true);
    });

    it('treats explicit zip targets as direct file destinations without retention cleanup', () => {
        const explicitZip = path.join(tempRoot, 'exports', 'manual-backup.zip');
        const manager = new BackupManager(createContext(), tempRoot);
        const target = (manager as unknown as BackupManagerInternals).resolveBackupTarget(explicitZip);

        expect(target.directoryPath).toBe(path.dirname(explicitZip));
        expect(target.filePath).toBe(explicitZip);
        expect(target.shouldApplyRetentionCleanup).toBe(false);
        expect(fs.existsSync(path.dirname(explicitZip))).toBe(true);
    });

    it('deletes only expired zip backups based on retention days', async () => {
        multiConfigGet.mockImplementation((key: string, fallback?: unknown) => {
            if (key === 'backup.retentionDays') {
                return 30;
            }
            return fallback;
        });

        const backupDir = path.join(tempRoot, 'retention');
        fs.mkdirSync(backupDir, { recursive: true });

        const expiredZip = path.join(backupDir, 'expired.zip');
        const recentZip = path.join(backupDir, 'recent.zip');
        const keepText = path.join(backupDir, 'notes.txt');

        fs.writeFileSync(expiredZip, 'expired', 'utf8');
        fs.writeFileSync(recentZip, 'recent', 'utf8');
        fs.writeFileSync(keepText, 'keep', 'utf8');

        const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
        fs.utimesSync(expiredZip, fortyDaysAgo, fortyDaysAgo);
        fs.utimesSync(recentZip, fiveDaysAgo, fiveDaysAgo);

        const manager = new BackupManager(createContext(), tempRoot);
        await (manager as unknown as BackupManagerInternals).cleanOldBackups(backupDir);

        expect(fs.existsSync(expiredZip)).toBe(false);
        expect(fs.existsSync(recentZip)).toBe(true);
        expect(fs.existsSync(keepText)).toBe(true);
    });
});
