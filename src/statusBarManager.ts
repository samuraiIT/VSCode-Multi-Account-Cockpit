import * as vscode from 'vscode';
import { Account, Platform, PLATFORM_LABELS } from './types';
import { AccountManager } from './accountManager';
import { QuotaService } from './quotaService';

/**
 * Manages the VS Code status bar item that shows the active account
 * and quota summary for the most critical model across all platforms.
 */
export class StatusBarManager implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly quotaService: QuotaService;

  constructor(
    private readonly accountManager: AccountManager,
    private readonly openDashboardCommand: string
  ) {
    this.quotaService = new QuotaService();
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = openDashboardCommand;
    this.statusBarItem.tooltip = 'Multi-Account Cockpit — click to open dashboard';
    this.statusBarItem.show();
    this.refresh();
  }

  async refresh(): Promise<void> {
    const accounts = this.accountManager.getAll();
    const active = accounts.filter((a) => a.active);

    if (active.length === 0) {
      this.statusBarItem.text = '$(account) Cockpit';
      this.statusBarItem.tooltip = 'No active accounts — click to open dashboard';
      return;
    }

    // Collect summaries for all active accounts
    const summaries: string[] = [];
    for (const acc of active.slice(0, 3)) {
      // show at most 3 platforms in status bar
      const summary = this.buildSummary(acc);
      summaries.push(summary);
    }

    const format = this.getFormat();
    if (format === 'icon') {
      this.statusBarItem.text = '$(account)';
    } else {
      this.statusBarItem.text = `$(account) ${summaries.join(' | ')}`;
    }

    this.statusBarItem.tooltip = this.buildTooltip(active);
  }

  private buildSummary(account: Account): string {
    const label = PLATFORM_LABELS[account.platform];
    const quota = account.quota;
    if (!quota || quota.models.length === 0) {
      return `${label}: ${account.label}`;
    }
    const lowestModel = quota.models.reduce((a, b) => a.percentRemaining < b.percentRemaining ? a : b);
    const dot = this.quotaDot(lowestModel.percentRemaining);
    return `${dot} ${label}: ${lowestModel.percentRemaining}%`;
  }

  private buildTooltip(active: Account[]): vscode.MarkdownString {
    const lines: string[] = ['### Multi-Account Cockpit', ''];
    for (const acc of active) {
      const label = PLATFORM_LABELS[acc.platform];
      lines.push(`**${label}** — ${acc.label}`);
      if (acc.quota?.models?.length) {
        for (const m of acc.quota.models) {
          const bar = this.progressBar(m.percentRemaining);
          lines.push(`  ${bar} ${m.modelName}: ${m.percentRemaining}%`);
        }
      }
      lines.push('');
    }
    const md = new vscode.MarkdownString(lines.join('\n'));
    md.isTrusted = true;
    return md;
  }

  private progressBar(percent: number): string {
    const filled = Math.round(percent / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  }

  private quotaDot(percent: number): string {
    const cfg = vscode.workspace.getConfiguration('multiAccountCockpit');
    const warn = cfg.get<number>('warningThreshold', 30);
    const crit = cfg.get<number>('criticalThreshold', 10);
    if (percent <= crit) return '🔴';
    if (percent <= warn) return '🟡';
    return '🟢';
  }

  private getFormat(): string {
    return vscode.workspace.getConfiguration('multiAccountCockpit').get<string>('statusBarFormat', 'full');
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
