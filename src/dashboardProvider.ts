import * as vscode from 'vscode';
import * as path from 'path';
import { AccountManager } from './accountManager';
import { Account, Platform, PLATFORM_LABELS, ALL_PLATFORMS, WebviewMessage } from './types';
import { QuotaService } from './quotaService';
import { formatTimestamp, formatTimeRemaining } from './utils';
import { CockpitToolsImporter } from './cockpitToolsImporter';

/**
 * Provides the multi-account WebView dashboard panel.
 */
export class DashboardProvider {
  private panel: vscode.WebviewPanel | undefined;
  private readonly quotaService: QuotaService;
  private readonly importer: CockpitToolsImporter;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly accountManager: AccountManager
  ) {
    this.quotaService = new QuotaService();
    this.importer = new CockpitToolsImporter(accountManager);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'multiAccountCockpit.dashboard',
      'Multi-Account Cockpit',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'icon.svg'),
      dark:  vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'icon.svg'),
    };

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      undefined,
      this.context.subscriptions
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    await this.updatePanel();
  }

  /** Push a fresh state to the open panel (if any). */
  async refresh(): Promise<void> {
    if (!this.panel) return;
    await this.updatePanel();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async updatePanel(): Promise<void> {
    if (!this.panel) return;
    const accounts = this.accountManager.getAll();
    this.panel.webview.html = this.renderHtml(accounts);
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.command) {
      case 'refresh':
        await this.refreshQuotas();
        break;
      case 'setActive': {
        const { accountId } = msg.payload as { accountId: string };
        this.accountManager.setActive(accountId);
        await this.updatePanel();
        break;
      }
      case 'deleteAccount': {
        const { accountId } = msg.payload as { accountId: string };
        const confirm = await vscode.window.showWarningMessage(
          'Delete this account?',
          { modal: true },
          'Delete'
        );
        if (confirm === 'Delete') {
          this.accountManager.remove(accountId);
          await this.updatePanel();
        }
        break;
      }
      case 'importFromCockpitTools':
        await this.importFromCockpitTools();
        break;
      case 'exportAccounts':
        await this.exportAccounts();
        break;
      case 'importAccountsJson':
        await this.importAccountsJson();
        break;
      case 'backup':
        await this.backup();
        break;
    }
  }

  private async refreshQuotas(): Promise<void> {
    if (!this.panel) return;
    this.panel.webview.postMessage({ command: 'setLoading', payload: true });

    const accounts = this.accountManager.getAll();
    for (const acc of accounts) {
      const quota = await this.quotaService.fetchQuota(acc);
      if (quota) {
        this.accountManager.update(acc.id, { quota });
      }
    }

    await this.updatePanel();
    this.panel?.webview.postMessage({ command: 'setLoading', payload: false });
  }

  private async importFromCockpitTools(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('multiAccountCockpit');
    const customDir = cfg.get<string>('cockpitToolsDataDir', '');
    const dir = customDir || undefined;

    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Importing from Cockpit Tools…', cancellable: false },
      () => this.importer.importAll(dir)
    );

    const msg = `Import complete: ${result.added} added, ${result.updated} updated.` +
      (result.errors.length ? ` ${result.errors.length} errors.` : '');
    vscode.window.showInformationMessage(msg);
    await this.updatePanel();
  }

  private async exportAccounts(): Promise<void> {
    const json = this.accountManager.exportJson();
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('cockpit-accounts.json'),
      filters: { JSON: ['json'] },
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
      vscode.window.showInformationMessage('Accounts exported successfully.');
    }
  }

  private async importAccountsJson(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ['json'] },
    });
    if (!uris || uris.length === 0) return;
    const raw = await vscode.workspace.fs.readFile(uris[0]);
    try {
      const result = this.accountManager.importJson(Buffer.from(raw).toString('utf-8'));
      vscode.window.showInformationMessage(`Import complete: ${result.added} added, ${result.updated} updated.`);
      await this.updatePanel();
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async backup(): Promise<void> {
    const manifest = this.accountManager.backup();
    vscode.window.showInformationMessage(
      `Backup created: ${manifest.backupId} (${manifest.accountCount} accounts)`
    );
  }

  // ── HTML rendering ─────────────────────────────────────────────────────────

  private renderHtml(accounts: Account[]): string {
    const byPlatform: Record<string, Account[]> = {};
    for (const acc of accounts) {
      (byPlatform[acc.platform] ??= []).push(acc);
    }

    const platformCards = ALL_PLATFORMS.map((p) => {
      const list = byPlatform[p] ?? [];
      return this.renderPlatformSection(p, list);
    }).join('\n');

    const totalAccounts = accounts.length;
    const activeAccounts = accounts.filter((a) => a.active).length;

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Multi-Account Cockpit</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --input-bg: var(--vscode-input-background);
      --button-bg: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --button-hover: var(--vscode-button-hoverBackground);
      --badge-bg: var(--vscode-badge-background);
      --badge-fg: var(--vscode-badge-foreground);
      --card-bg: var(--vscode-editorGroupHeader-tabsBackground);
      --success: #4caf50;
      --warn: #ff9800;
      --danger: #f44336;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); padding: 16px; }
    h1 { font-size: 1.4em; font-weight: 600; margin-bottom: 4px; }
    .subtitle { opacity: 0.7; margin-bottom: 16px; font-size: 0.9em; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    button { padding: 5px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em; background: var(--button-bg); color: var(--button-fg); }
    button:hover { background: var(--button-hover); }
    button.secondary { background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); }
    .platform-section { margin-bottom: 24px; }
    .platform-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
    .platform-header h2 { font-size: 1em; font-weight: 600; }
    .platform-count { background: var(--badge-bg); color: var(--badge-fg); border-radius: 10px; padding: 1px 7px; font-size: 0.8em; }
    .account-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .account-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; position: relative; }
    .account-card.active { border-color: var(--success); }
    .account-card .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
    .account-label { font-weight: 600; font-size: 0.95em; }
    .account-email { font-size: 0.8em; opacity: 0.7; margin-bottom: 6px; }
    .active-badge { background: var(--success); color: #fff; border-radius: 3px; padding: 1px 6px; font-size: 0.75em; }
    .source-badge { background: var(--badge-bg); color: var(--badge-fg); border-radius: 3px; padding: 1px 6px; font-size: 0.75em; }
    .quota-bar-wrap { margin: 6px 0; }
    .quota-model-name { font-size: 0.8em; opacity: 0.8; margin-bottom: 2px; }
    .quota-bar { height: 6px; border-radius: 3px; background: var(--input-bg); overflow: hidden; margin-bottom: 1px; }
    .quota-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .quota-bar-fill.ok   { background: var(--success); }
    .quota-bar-fill.warn { background: var(--warn); }
    .quota-bar-fill.crit { background: var(--danger); }
    .quota-pct { font-size: 0.75em; opacity: 0.8; }
    .card-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .card-actions button { padding: 3px 8px; font-size: 0.8em; }
    .empty-state { opacity: 0.5; font-style: italic; font-size: 0.9em; padding: 8px 0; }
    .stats { display: flex; gap: 20px; margin-bottom: 16px; }
    .stat { text-align: center; }
    .stat-value { font-size: 1.5em; font-weight: 700; }
    .stat-label { font-size: 0.8em; opacity: 0.7; }
    #loading-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.3); justify-content: center; align-items: center; z-index: 999; }
    #loading-overlay.active { display: flex; }
    .spinner { width: 36px; height: 36px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="loading-overlay"><div class="spinner"></div></div>

  <h1>🚀 Multi-Account Cockpit</h1>
  <p class="subtitle">Unified AI IDE account manager</p>

  <div class="stats">
    <div class="stat"><div class="stat-value">${totalAccounts}</div><div class="stat-label">Total Accounts</div></div>
    <div class="stat"><div class="stat-value">${activeAccounts}</div><div class="stat-label">Active</div></div>
    <div class="stat"><div class="stat-value">${Object.keys(byPlatform).length}</div><div class="stat-label">Platforms</div></div>
  </div>

  <div class="toolbar">
    <button onclick="send('refresh')">🔄 Refresh Quotas</button>
    <button onclick="send('importFromCockpitTools')" class="secondary">📥 Import from Cockpit Tools</button>
    <button onclick="send('importAccountsJson')" class="secondary">📂 Import JSON</button>
    <button onclick="send('exportAccounts')" class="secondary">📤 Export JSON</button>
    <button onclick="send('backup')" class="secondary">💾 Backup</button>
  </div>

  ${platformCards}

  <script>
    const vscode = acquireVsCodeApi();
    function send(command, payload) {
      vscode.postMessage({ command, payload });
    }
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.command === 'setLoading') {
        document.getElementById('loading-overlay').classList.toggle('active', msg.payload);
      }
    });
  </script>
</body>
</html>`;
  }

  private renderPlatformSection(platform: Platform, accounts: Account[]): string {
    const label = PLATFORM_LABELS[platform];
    const cards = accounts.length
      ? accounts.map((a) => this.renderAccountCard(a)).join('\n')
      : `<p class="empty-state">No ${label} accounts — use "Import from Cockpit Tools" or add manually.</p>`;

    return /* html */`
<div class="platform-section">
  <div class="platform-header">
    <h2>${label}</h2>
    <span class="platform-count">${accounts.length}</span>
  </div>
  <div class="account-grid">
    ${cards}
  </div>
</div>`;
  }

  private renderAccountCard(account: Account): string {
    const isActive = account.active;
    const quota = account.quota;
    const quotaBars = quota?.models?.map((m) => {
      const pct = m.percentRemaining;
      const cls = pct <= 10 ? 'crit' : pct <= 30 ? 'warn' : 'ok';
      return /* html */`
<div class="quota-bar-wrap">
  <div class="quota-model-name">${this.esc(m.modelName)}</div>
  <div class="quota-bar"><div class="quota-bar-fill ${cls}" style="width:${pct}%"></div></div>
  <div class="quota-pct">${pct}% remaining${m.resetAt ? ` · resets in ${formatTimeRemaining(m.resetAt)}` : ''}</div>
</div>`;
    }).join('') ?? '';

    return /* html */`
<div class="account-card ${isActive ? 'active' : ''}">
  <div class="card-header">
    <div>
      <div class="account-label">${this.esc(account.label)}</div>
      ${account.email ? `<div class="account-email">${this.esc(account.email)}</div>` : ''}
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
      ${isActive ? '<span class="active-badge">Active</span>' : ''}
      <span class="source-badge">${this.esc(account.source)}</span>
    </div>
  </div>
  ${quota?.plan ? `<div style="font-size:0.8em;opacity:0.7;margin-bottom:4px;">Plan: ${this.esc(quota.plan)}</div>` : ''}
  ${quota?.error ? `<div style="font-size:0.8em;color:var(--danger);">⚠ ${this.esc(quota.error)}</div>` : ''}
  ${quotaBars}
  <div class="card-actions">
    ${!isActive ? `<button onclick="send('setActive',{accountId:'${account.id}'})">⚡ Set Active</button>` : ''}
    <button class="secondary" onclick="send('deleteAccount',{accountId:'${account.id}'})">🗑 Delete</button>
  </div>
</div>`;
  }

  private esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
