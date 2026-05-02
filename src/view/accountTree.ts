/**
 *
 * 
 *
 * -
 * -
 * -
 * 
 *
 * -
 * -
 */

import * as vscode from 'vscode';
import { cockpitToolsWs } from '../services/cockpitToolsWs';
import { AccountsRefreshService } from '../services/accountsRefreshService';
import { ModelQuotaInfo, QuotaGroup } from '../shared/types';
import { t } from '../shared/i18n';
import { accountSwitchService } from '../services/accountSwitchService';
import { openCockpitToolsDesktop } from '../shared/cockpit_tools_launcher';

// Types

// Types moved to AccountsRefreshService

// Tree Node Types

export type AccountTreeItem = AccountNode | GroupNode | ModelNode | CreditsNode | ToolsStatusNode | LoadingNode | ErrorNode;

/**
 *
 */
export class AccountNode extends vscode.TreeItem {
    constructor(
        public readonly email: string,
        public readonly isCurrent: boolean,
        public readonly isInvalid?: boolean,
        public readonly isForbidden?: boolean,
    ) {
        super(email, vscode.TreeItemCollapsibleState.Expanded);

        if (isInvalid) {

            this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
        } else if (isForbidden) {

            this.iconPath = new vscode.ThemeIcon('lock', new vscode.ThemeColor('errorForeground'));
        } else if (isCurrent) {

            this.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
        } else {

            this.iconPath = new vscode.ThemeIcon('account');
        }

        // Tooltip
        const parts = [
            `${t('accountTree.tooltipEmail')}: ${email}`,
            isInvalid ? `⚠️ ${t('accountsRefresh.authExpired')}` : '',
            isForbidden ? `🔒 ${t('accountsRefresh.forbidden')}` : '',
            isCurrent && !isInvalid ? t('accountTree.currentAccount') : '',
        ].filter(Boolean);
        this.tooltip = parts.join('\n');

        // Context for menus
        this.contextValue = isCurrent ? 'accountCurrent' : 'account';
    }
}

/**
 *
 */
export class GroupNode extends vscode.TreeItem {
    constructor(
        public readonly group: QuotaGroup,
        public readonly accountEmail: string,
    ) {
        super(group.groupName, vscode.TreeItemCollapsibleState.Collapsed);

        const pct = Math.round(group.remainingPercentage);
        
        // Status icon based on percentage
        let color: vscode.ThemeColor | undefined;
        if (pct <= 10) {
            color = new vscode.ThemeColor('errorForeground');
        } else if (pct <= 30) {
            color = new vscode.ThemeColor('editorWarning.foreground');
        } else {
            color = new vscode.ThemeColor('charts.green');
        }

        this.iconPath = new vscode.ThemeIcon('circle-filled', color);
        
        const resetTime = group.timeUntilResetFormatted || '-';
        this.description = `${pct}%  ${resetTime}`;
        
        this.tooltip = [
            `${t('groupNode.group')}: ${group.groupName}`,
            `${t('groupNode.quota')}: ${pct}%`,
            `${t('groupNode.reset')}: ${group.resetTimeDisplay}`,
            t('groupNode.modelsCount', { count: group.models.length.toString() }),
        ].join('\n');

        this.contextValue = 'group';
    }
}

/**
 *
 */
export class ModelNode extends vscode.TreeItem {
    constructor(
        public readonly model: ModelQuotaInfo,
        public readonly accountEmail: string,
    ) {
        super(model.label, vscode.TreeItemCollapsibleState.None);

        this.iconPath = new vscode.ThemeIcon('symbol-method');
        this.tooltip = `${model.label}\n${t('accountTree.tooltipModelId')}: ${model.modelId}`;
        this.contextValue = 'model';
    }
}

/**
 * Credits
 */
export class CreditsNode extends vscode.TreeItem {
    constructor(
        public readonly accountEmail: string,
        public readonly credits: number | null,
    ) {
        super('Credits', vscode.TreeItemCollapsibleState.None);
        this.description = credits === null ? '--' : formatCreditsNumber(credits);
        this.iconPath = new vscode.ThemeIcon('credit-card');
        this.tooltip = `Credits: ${this.description}`;
        this.contextValue = 'credits';
    }
}

/**
 * Tools
 */
export class ToolsStatusNode extends vscode.TreeItem {
    constructor(
        public readonly accountEmail: string,
        public readonly online: boolean,
    ) {
        super(
            online ? 'Tools: Online' : 'Tools: Offline',
            vscode.TreeItemCollapsibleState.None,
        );

        this.iconPath = new vscode.ThemeIcon(
            online ? 'link' : 'debug-disconnect',
            online ? new vscode.ThemeColor('charts.green') : new vscode.ThemeColor('errorForeground'),
        );
        this.tooltip = online
            ? 'Cockpit Tools WebSocket: Connected'
            : 'Cockpit Tools WebSocket: Disconnected';
        this.contextValue = online ? 'toolsOnline' : 'toolsOffline';
    }
}

/**
 *
 */
export class LoadingNode extends vscode.TreeItem {
    constructor() {
        super(t('accountTree.loading'), vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('loading~spin');
    }
}

/**
 *
 */
export class ErrorNode extends vscode.TreeItem {
    constructor(message: string) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
        this.contextValue = 'error';
    }
}

// Tree Data Provider

export class AccountTreeProvider implements vscode.TreeDataProvider<AccountTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AccountTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private refreshSubscription: vscode.Disposable;

    constructor(private readonly refreshService: AccountsRefreshService) {
        this.refreshSubscription = this.refreshService.onDidUpdate(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    dispose(): void {
        this.refreshSubscription.dispose();
    }

    /**
     *
     */
    async manualRefresh(): Promise<boolean> {
        return this.refreshService.manualRefresh();
    }

    /**
     *
     *
     */
    async refreshQuotas(): Promise<void> {
        await this.refreshService.refreshQuotas();
    }

    /**
     *
     */
    async refresh(): Promise<void> {
        await this.refreshService.refresh();
    }

    /**
     *
     */
    async loadAccountQuota(email: string): Promise<void> {
        await this.refreshService.loadAccountQuota(email);
    }

    getTreeItem(element: AccountTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AccountTreeItem): Promise<AccountTreeItem[]> {
        if (!element) {
            // Root level: account list
            return this.getRootChildren();
        }

        if (element instanceof AccountNode) {
            // Account children: groups or loading
            return this.getAccountChildren(element.email);
        }

        if (element instanceof GroupNode) {
            // Group children: models
            return element.group.models.map(m => new ModelNode(m, element.accountEmail));
        }

        return [];
    }

    private getRootChildren(): AccountTreeItem[] {
        const initError = this.refreshService.getInitError();
        if (initError) {
            return [new ErrorNode(initError)];
        }

        if (!this.refreshService.isInitialized()) {
            return [new LoadingNode()];
        }

        const accounts = this.refreshService.getAccountsMap();
        if (accounts.size === 0) {
            return [new ErrorNode(t('accountTree.noAccounts'))];
        }

        const nodes: AccountNode[] = [];
        for (const [email, account] of accounts) {
            nodes.push(
                new AccountNode(
                    email,
                    account.isCurrent,
                    account.isInvalid,
                    account.isForbidden,
                ),
            );
        }

        return nodes;
    }

    private getAccountChildren(email: string): AccountTreeItem[] {
        const cache = this.refreshService.getQuotaCache(email);
        const account = this.refreshService.getAccount(email);

        if (account && !account.hasPluginCredential) {
            return [
                new ErrorNode(t('accountTree.notImported')),
                new ToolsStatusNode(email, cockpitToolsWs.isConnected),
            ];
        }

        if (!cache || cache.loading) {
            return [new LoadingNode()];
        }

        if (cache.error) {
            return [
                new ErrorNode(cache.error),
                new ToolsStatusNode(email, cockpitToolsWs.isConnected),
            ];
        }

        const children: AccountTreeItem[] = [];
        const snapshot = cache.snapshot;

        if (snapshot.groups && snapshot.groups.length > 0) {
            for (const group of snapshot.groups) {
                children.push(new GroupNode(group, email));
            }
        } else if (snapshot.models.length > 0) {
            for (const model of snapshot.models) {
                children.push(new ModelNode(model, email));
            }
        } else {
            children.push(new ErrorNode(t('accountTree.noQuotaData')));
        }


        children.push(new CreditsNode(email, resolveAvailableAICredits(snapshot)));


        children.push(new ToolsStatusNode(email, cockpitToolsWs.isConnected));

        return children;
    }

    /**
     *
     */
    getCurrentEmail(): string | null {
        return this.refreshService.getCurrentEmail();
    }

    /**
     *
     */
    async getAccountId(email: string): Promise<string | null> {
        return this.refreshService.getAccountId(email);
    }
}

function resolveAvailableAICredits(snapshot: { availableAICredits?: number; promptCredits?: { available?: number }; userInfo?: { availablePromptCredits?: number } }): number | null {
    if (Number.isFinite(snapshot.availableAICredits)) {
        return Math.max(0, Number(snapshot.availableAICredits));
    }
    if (snapshot.promptCredits && Number.isFinite(snapshot.promptCredits.available)) {
        return Math.max(0, Number(snapshot.promptCredits.available));
    }
    if (snapshot.userInfo && Number.isFinite(snapshot.userInfo.availablePromptCredits)) {
        return Math.max(0, Number(snapshot.userInfo.availablePromptCredits));
    }
    return null;
}

function formatCreditsNumber(value: number): string {
    if (!Number.isFinite(value)) {
        return '--';
    }
    const rounded = Math.abs(value - Math.round(value)) < 1e-6
        ? Math.round(value)
        : Number(value.toFixed(2));
    return rounded.toLocaleString();
}

// Commands

export function registerAccountTreeCommands(
    context: vscode.ExtensionContext,
    provider: AccountTreeProvider,
): void {

    context.subscriptions.push(
        vscode.commands.registerCommand('agCockpit.accountTree.refresh', async () => {
            cockpitToolsWs.ensureConnected();
            await provider.manualRefresh();
        }),
    );

    // Load account quota
    context.subscriptions.push(
        vscode.commands.registerCommand('agCockpit.accountTree.loadAccountQuota', async (email: string) => {
            await provider.loadAccountQuota(email);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agCockpit.accountTree.switch', async (node: AccountNode) => {

            const currentEmail = provider.getCurrentEmail();
            const confirmMessage = currentEmail 
                ? t('account.switch.confirmWithCurrent', { current: currentEmail, target: node.email })
                : t('account.switch.confirmNoCurrent', { target: node.email });
            
            const confirm = await vscode.window.showWarningMessage(
                confirmMessage,
                { modal: true },
                t('account.switch.confirmOk'),
            );
            
            if (confirm !== t('account.switch.confirmOk')) {
                return;
            }
            
            const result = await accountSwitchService.switchAccount(node.email, {
                requestedMode: 'default',
            });
            if (!result.success) {
                if (result.errorCode === 'tools_offline' && result.mode === 'default') {
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
                    return;
                }
                vscode.window.showErrorMessage(result.message || t('accountTree.sendSwitchFailed'));
                return;
            }

            if (accountSwitchService.isSeamlessMode(result.mode)) {
                vscode.window.showInformationMessage(`Seamlessly switched to account: ${result.email ?? node.email}`);
            } else {
                vscode.window.showInformationMessage(t('accountTree.switchingTo', { email: node.email }));
            }
            await provider.refresh();
        }),
    );

    // Open Cockpit Tools
    context.subscriptions.push(
        vscode.commands.registerCommand('agCockpit.accountTree.openManager', async () => {
            const opened = await openCockpitToolsDesktop('AccountTree');
            if (!opened) {
                vscode.window.showWarningMessage(t('accountTree.cannotOpenCockpitTools'));
            }
        }),
    );
}
