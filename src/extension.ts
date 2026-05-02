import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { AccountManager } from './accountManager';
import { DashboardProvider } from './dashboardProvider';
import { StatusBarManager } from './statusBarManager';
import { CockpitToolsImporter } from './cockpitToolsImporter';
import { ProcessManager } from './processManager';
import { QuotaService } from './quotaService';

let refreshTimer: NodeJS.Timeout | undefined;
let statusBarManager: StatusBarManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // ── Core services ────────────────────────────────────────────────────────
  const accountManager = new AccountManager(context);
  const dashboardProvider = new DashboardProvider(context, accountManager);
  const processManager = new ProcessManager();
  const quotaService = new QuotaService();
  const importer = new CockpitToolsImporter(accountManager);

  statusBarManager = new StatusBarManager(accountManager, 'multiAccountCockpit.openDashboard');
  context.subscriptions.push(statusBarManager);

  // ── Auto-refresh ─────────────────────────────────────────────────────────
  function scheduleRefresh(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    const cfg = vscode.workspace.getConfiguration('multiAccountCockpit');
    const interval = cfg.get<number>('autoRefreshInterval', 5) * 60_000;
    refreshTimer = setInterval(async () => {
      await refreshAllQuotas(accountManager, quotaService);
      await dashboardProvider.refresh();
      await statusBarManager?.refresh();
    }, interval);
  }

  scheduleRefresh();
  context.subscriptions.push({
    dispose: () => { if (refreshTimer) clearInterval(refreshTimer); },
  });

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('multiAccountCockpit.autoRefreshInterval')) {
      scheduleRefresh();
    }
  }, undefined, context.subscriptions);

  // ── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('multiAccountCockpit.openDashboard', async () => {
      await dashboardProvider.open();
    }),

    vscode.commands.registerCommand('multiAccountCockpit.importFromCockpitTools', async () => {
      const cfg = vscode.workspace.getConfiguration('multiAccountCockpit');
      const customDir = cfg.get<string>('cockpitToolsDataDir', '') || undefined;
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Importing from Cockpit Tools…', cancellable: false },
        () => importer.importAll(customDir)
      );
      const msg = `Cockpit Tools import: ${result.added} added, ${result.updated} updated.` +
        (result.errors.length ? ` (${result.errors.length} platform errors)` : '');
      vscode.window.showInformationMessage(msg);
      await dashboardProvider.refresh();
      await statusBarManager?.refresh();
    }),

    vscode.commands.registerCommand('multiAccountCockpit.refreshQuotas', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Refreshing quotas…', cancellable: false },
        () => refreshAllQuotas(accountManager, quotaService)
      );
      await dashboardProvider.refresh();
      await statusBarManager?.refresh();
      vscode.window.showInformationMessage('Quotas refreshed.');
    }),

    vscode.commands.registerCommand('multiAccountCockpit.exportAccounts', async () => {
      const json = accountManager.exportJson();
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('cockpit-accounts.json'),
        filters: { JSON: ['json'] },
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
        vscode.window.showInformationMessage('Accounts exported.');
      }
    }),

    vscode.commands.registerCommand('multiAccountCockpit.importAccountsJson', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { JSON: ['json'] },
      });
      if (!uris?.length) return;
      const raw = await vscode.workspace.fs.readFile(uris[0]);
      try {
        const result = accountManager.importJson(Buffer.from(raw).toString('utf-8'));
        vscode.window.showInformationMessage(`Import complete: ${result.added} added, ${result.updated} updated.`);
        await dashboardProvider.refresh();
        await statusBarManager?.refresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand('multiAccountCockpit.backupAccounts', async () => {
      const manifest = accountManager.backup();
      vscode.window.showInformationMessage(
        `Backup created: ${manifest.backupId} (${manifest.accountCount} accounts, ${manifest.platforms.join(', ')}).`
      );
    }),

    vscode.commands.registerCommand('multiAccountCockpit.restoreAccounts', async () => {
      const backups = accountManager.listBackups();
      if (!backups.length) {
        vscode.window.showWarningMessage('No backups found.');
        return;
      }
      const items = backups
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((b) => ({
          label: b.backupId,
          description: `${b.accountCount} accounts · ${new Date(b.createdAt).toLocaleString()}`,
          backupId: b.backupId,
        }));
      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a backup to restore' });
      if (!pick) return;
      const confirm = await vscode.window.showWarningMessage(
        `Restore from backup "${pick.backupId}"? Current accounts will be replaced.`,
        { modal: true },
        'Restore'
      );
      if (confirm === 'Restore') {
        const count = accountManager.restore(pick.backupId);
        vscode.window.showInformationMessage(`Restored ${count} accounts from backup.`);
        await dashboardProvider.refresh();
        await statusBarManager?.refresh();
      }
    }),

    vscode.commands.registerCommand('multiAccountCockpit.addAccount', async () => {
      const platforms = ['antigravity', 'codex', 'copilot', 'windsurf', 'kiro', 'cursor',
        'gemini-cli', 'codebuddy', 'codebuddy-cn', 'qoder', 'trae', 'zed'] as const;
      const platformPick = await vscode.window.showQuickPick(
        platforms.map((p) => ({ label: p, description: '' })),
        { placeHolder: 'Select platform' }
      );
      if (!platformPick) return;

      const label = await vscode.window.showInputBox({ prompt: 'Account label (e.g. email or alias)', placeHolder: 'my-account@example.com' });
      if (!label) return;

      const token = await vscode.window.showInputBox({ prompt: 'Refresh Token or Access Token (optional)', password: true });

      accountManager.add(
        platformPick.label,
        label,
        { refreshToken: token || undefined },
        'manual',
        label
      );
      vscode.window.showInformationMessage(`Account "${label}" added for ${platformPick.label}.`);
      await dashboardProvider.refresh();
      await statusBarManager?.refresh();
    }),

    vscode.commands.registerCommand('multiAccountCockpit.diagnose', async () => {
      const detectedDir = importer.detectDataDir();
      const lines = [
        `OS: ${process.platform} ${os.release()}`,
        `Node: ${process.version}`,
        `Cockpit Tools data dir: ${detectedDir ?? 'NOT FOUND'}`,
        `Accounts stored: ${accountManager.getAll().length}`,
        `Extension storage: ${context.globalStorageUri.fsPath}`,
      ];
      const channel = vscode.window.createOutputChannel('Multi-Account Cockpit Diagnostics');
      channel.appendLine(lines.join('\n'));
      channel.show();
    })
  );

  // ── Listen for account changes ────────────────────────────────────────────
  accountManager.onDidChange(async () => {
    await statusBarManager?.refresh();
  }, undefined, context.subscriptions);
}

export function deactivate(): void {
  if (refreshTimer) clearInterval(refreshTimer);
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function refreshAllQuotas(
  accountManager: AccountManager,
  quotaService: QuotaService
): Promise<void> {
  const accounts = accountManager.getAll();
  await Promise.allSettled(
    accounts.map(async (acc) => {
      try {
        const quota = await quotaService.fetchQuota(acc);
        if (quota) accountManager.update(acc.id, { quota });
      } catch {
        // ignore per-account errors
      }
    })
  );
}
