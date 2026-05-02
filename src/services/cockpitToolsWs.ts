/**
 * Cockpit Tools WebSocket
 *
 */

import { EventEmitter } from 'events';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../shared/log_service';
import { getCockpitToolsSharedDir, isAntigravityWslRemote } from '../shared/antigravity_paths';

const SERVER_CONFIG_FILE = 'server.json';

const DEFAULT_WS_PORT = 19528;

const RECONNECT_INTERVAL = 5000;
const RECONNECT_INTERVAL_MAX = 30000;
const PING_INTERVAL = 30000;
const REQUEST_TIMEOUT = 10000;

export interface ServerConfig {
    ws_port: number;
    version: string;
    pid: number;
    started_at: number;
}

/**
 *
 * @returns
 */
export function readServerConfig(): ServerConfig | null {
    try {
        const configPath = path.join(getCockpitToolsSharedDir(), SERVER_CONFIG_FILE);
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(content) as ServerConfig;
        }
    } catch (error) {
        logger.debug('[WS] Failed to read server configuration:', error);
    }
    return null;
}

function resolveWslWindowsHost(): string {
    try {
        const defaultRoute = childProcess.execFileSync(
            'ip',
            ['route', 'show', 'default'],
            { encoding: 'utf8' },
        ).trim();
        const gatewayMatch = defaultRoute.match(/\bdefault\s+via\s+([^\s]+)\b/i);
        if (gatewayMatch?.[1]) {
            return gatewayMatch[1];
        }
    } catch (error) {
        logger.debug('[WS] Failed to read WSL default gateway, will try resolv.conf:', error);
    }

    try {
        const content = fs.readFileSync('/etc/resolv.conf', 'utf-8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
            const match = line.match(/^\s*nameserver\s+([^\s#]+)\s*$/i);
            if (match?.[1]) {
                return match[1];
            }
        }
    } catch (error) {
        logger.debug('[WS] Failed to read /etc/resolv.conf, falling back to localhost:', error);
    }
    return '127.0.0.1';
}

function resolveWsHost(): string {
    if (isAntigravityWslRemote()) {
        const wslHost = resolveWslWindowsHost();
        logger.debug(`[WS] WSL host resolved to ${wslHost}`);
        return wslHost;
    }
    return '127.0.0.1';
}

function formatWsHost(host: string): string {
    if (host.includes(':') && !host.startsWith('[') && !host.endsWith(']')) {
        return `[${host}]`;
    }
    return host;
}

/**
 *
 * @returns WebSocket URL
 */
function getWsUrl(): string {
    const host = formatWsHost(resolveWsHost());
    const config = readServerConfig();
    if (config && config.ws_port > 0) {
        logger.debug(`[WS] Port read from configuration file: ${config.ws_port}, host=${host}`);
        return `ws://${host}:${config.ws_port}`;
    }
    
    return `ws://${host}:${DEFAULT_WS_PORT}`;
}

// Types

export interface WsMessage {
    type: string;
    payload?: unknown;
}

export interface ReadyPayload {
    version: string;
}

export interface DataChangedPayload {
    source: string;
}

export interface AccountSwitchedPayload {
    account_id: string;
    email: string;
}

export interface SwitchErrorPayload {
    message: string;
}

export interface LanguageChangedPayload {
    language: string;
    source?: string;
}

export interface WakeupOverridePayload {
    enabled: boolean;
}

export type WsSwitchMode = 'default' | 'seamless' | 'auto';
export type WsTriggerType = 'manual' | 'auto';

export interface PluginSetSwitchModePayload {
    request_id?: string;
    switch_mode?: WsSwitchMode;
    source?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
}

export interface PluginSetSwitchModeResponsePayload {
    request_id?: string;
    success: boolean;
    applied_mode?: Exclude<WsSwitchMode, 'auto'>;
    error_message?: string;
    finished_at: string;
}

export interface PluginSwitchAccountPayload {
    request_id?: string;
    target_email?: string;
    switch_mode?: WsSwitchMode;
    trigger_type?: WsTriggerType;
    trigger_source?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
}

export interface PluginSwitchAccountResponsePayload {
    execution_id: string;
    request_id?: string;
    success: boolean;
    effective_mode: Exclude<WsSwitchMode, 'auto'>;
    from_email: string | null;
    to_email: string;
    duration_ms: number;
    error_code: string | null;
    error_message: string | null;
    finished_at: string;
}

export interface AccountInfo {
    id: string;
    email: string;
    name: string | null;
    is_current: boolean;
    disabled: boolean;
    has_fingerprint: boolean;
    last_used: number;
    subscription_tier?: string | null;
}

export interface AccountTokenInfo extends AccountInfo {
    refresh_token: string;
    access_token: string;
    expires_at: number;
    project_id?: string | null;
}

export interface AccountsResponse {
    accounts: AccountInfo[];
    current_account_id: string | null;
}

export interface AccountsWithTokensResponse {
    accounts: AccountTokenInfo[];
    current_account_id: string | null;
}

// WebSocket Client

class CockpitToolsWsClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private pingTimer: NodeJS.Timeout | null = null;
    private _isConnected = false;
    private _version: string | null = null;
    private _shouldReconnect = true;
    
    private reconnectFailCount = 0;
    private lastWsUrl: string | null = null;
    
    private pendingRequests: Map<string, {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }> = new Map();
    private requestIdCounter = 0;

    /**
     *
     */
    get isConnected(): boolean {
        return this._isConnected;
    }

    /**
     * Cockpit Tools
     */
    get version(): string | null {
        return this._version;
    }

    /**
     *
     */
    connect(): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        this._shouldReconnect = true;
        this.doConnect();
    }

    /**
     *
     */
    disconnect(): void {
        this._shouldReconnect = false;
        this.cleanup();
    }

    /**
     *
     */
    send(message: WsMessage): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            logger.warn('[WS] Not connected, cannot send message');
            return false;
        }

        try {
            this.ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            logger.error('[WS] Failed to send message:', error);
            return false;
        }
    }
    
    /**
     *
     */
    private sendRequest<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Not connected to Cockpit Tools'));
                return;
            }
            
            const requestId = `${++this.requestIdCounter}`;
            
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error('RequestTimeout'));
            }, REQUEST_TIMEOUT);
            
            this.pendingRequests.set(requestId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timeout,
            });
            
            const message: WsMessage = {
                type,
                payload: { ...payload, request_id: requestId },
            };
            
            if (!this.send(message)) {
                this.pendingRequests.delete(requestId);
                clearTimeout(timeout);
                reject(new Error('Failed to send request'));
            }
        });
    }
    
    /**
     *
     */
    async getAccounts(): Promise<AccountsResponse> {
        return this.sendRequest<AccountsResponse>('request.get_accounts');
    }

    /**
     *
     */
    async getAccountsWithTokens(): Promise<AccountsWithTokensResponse> {
        return this.sendRequest<AccountsWithTokensResponse>('request.get_accounts_with_tokens');
    }
    
    /**
     *
     */
    async getCurrentAccount(): Promise<AccountInfo | null> {
        const result = await this.sendRequest<{ account: AccountInfo | null }>('request.get_current_account');
        return result.account;
    }

    /**
     *
     */
    requestSwitchAccount(accountId: string): boolean {
        return this.send({
            type: 'request.switch_account',
            payload: { account_id: accountId },
        });
    }

    /**
     *
     */
    async switchAccount(accountId: string): Promise<{ success: boolean; message: string }> {
        try {
            const result = await this.sendRequest<{ message: string }>('request.switch_account', { account_id: accountId });
            return { success: true, message: result.message };
        } catch (error) {
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     *
     */
    notifyDataChanged(source: string): boolean {
        return this.send({
            type: 'request.data_changed',
            payload: { source },
        });
    }

    /**
     *
     *
     *
     * @returns
     */
    ensureConnected(): boolean {
        if (this._isConnected) {
            return true;
        }
        
        logger.info('[WS] Not connected, attempting forced reconnect...');

        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        this.reconnectFailCount = 0;
        this._shouldReconnect = true;
        this.doConnect();
        
        return false;
    }

    /**
     *
     *
     *
     * @param timeoutMs
     * @returns
     */
    waitForConnection(timeoutMs = 5000): Promise<boolean> {
        if (this._isConnected) {
            return Promise.resolve(true);
        }

        return new Promise<boolean>((resolve) => {
            let resolved = false;
            let timer: NodeJS.Timeout | null = null;

            const onConnected = () => {
                if (resolved) { return; }
                resolved = true;
                if (timer) { clearTimeout(timer); }
                this.removeListener('connected', onConnected);
                logger.info('[WS] Waiting for connection, continuing operation');
                resolve(true);
            };

            this.on('connected', onConnected);

            timer = setTimeout(() => {
                if (resolved) { return; }
                resolved = true;
                this.removeListener('connected', onConnected);
                logger.warn(`[WS] Connection wait timeout (${timeoutMs}ms)`);
                resolve(false);
            }, timeoutMs);

            this.ensureConnected();
        });
    }
    
    /**
     *
     * @param email
     * @param refreshToken Refresh Token
     * @param expiresAt
     */
    async addAccount(
        email: string,
        refreshToken: string,
        accessToken?: string,
        expiresAt?: number,
    ): Promise<{ success: boolean; message: string }> {
        try {
            const result = await this.sendRequest<{ message: string }>('request.add_account', {
                email,
                refresh_token: refreshToken,
                access_token: accessToken,
                expires_at: expiresAt,
            });
            return { success: true, message: result.message };
        } catch (error) {
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    }
    
    /**
     *
     * @param email
     */
    async deleteAccountByEmail(email: string): Promise<{ success: boolean; message: string }> {
        try {
            const result = await this.sendRequest<{ message: string }>('request.delete_account', {
                email,
            });
            return { success: true, message: result.message };
        } catch (error) {
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     *
     */
    async setLanguage(language: string, source = 'extension'): Promise<{ success: boolean; message: string }> {
        try {
            const result = await this.sendRequest<{ message: string }>('request.set_language', {
                language,
                source,
            });
            return { success: true, message: result.message };
        } catch (error) {
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    sendPluginSetSwitchModeResponse(payload: PluginSetSwitchModeResponsePayload): boolean {
        return this.send({
            type: 'response.plugin_set_switch_mode',
            payload,
        });
    }

    sendPluginSwitchAccountResponse(payload: PluginSwitchAccountResponsePayload): boolean {
        return this.send({
            type: 'response.plugin_switch_account',
            payload,
        });
    }

    // Private Methods

    private doConnect(): void {
        try {
            const wsUrl = getWsUrl();
            
            if (this.lastWsUrl && this.lastWsUrl !== wsUrl) {
                logger.info(`[WS] Port change detected: ${this.lastWsUrl} -> ${wsUrl}`);
            }
            this.lastWsUrl = wsUrl;
            
            logger.info(`[WS] Connecting to ${wsUrl}... (attempt: ${this.reconnectFailCount + 1})`);
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                logger.info('[WS] ConnectionSuccess');
                this._isConnected = true;
                this.reconnectFailCount = 0;
                this.emit('connected');
                this.startPing();
            };

            this.ws.onclose = (event) => {
                logger.info(`[WS] Connection closed: ${event.code}`);
                this._isConnected = false;
                this._version = null;
                this.emit('disconnected');
                this.stopPing();
                this.rejectAllPendingRequests('Connection disconnected');
                this.reconnectFailCount++;
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                logger.debug('[WS] ConnectionError:', error);
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };
        } catch (error) {
            logger.error('[WS] ConnectionFailed:', error);
            this.reconnectFailCount++;
            this.scheduleReconnect();
        }
    }

    private handleMessage(data: string): void {
        try {
            const message = JSON.parse(data) as WsMessage;
            const payload = message.payload as Record<string, unknown> | undefined;
            
            if (message.type.startsWith('response.') && payload?.request_id) {
                const requestId = payload.request_id as string;
                const pending = this.pendingRequests.get(requestId);
                if (pending) {
                    this.pendingRequests.delete(requestId);
                    clearTimeout(pending.timeout);
                    
                    if (message.type === 'response.error') {
                        pending.reject(new Error(payload.error as string || 'unknown error'));
                    } else {
                        pending.resolve(payload);
                    }
                    return;
                }
            }
            
            switch (message.type) {
                case 'event.ready': {
                    const readyPayload = payload as unknown as ReadyPayload;
                    this._version = readyPayload.version;
                    logger.info(`[WS] Cockpit Tools ready, version: ${readyPayload.version}`);
                    this.emit('ready', readyPayload);
                    break;
                }

                case 'event.data_changed': {
                    const changedPayload = payload as unknown as DataChangedPayload;
                    logger.info(`[WS] Data changed: ${changedPayload.source}`);
                    this.emit('dataChanged', changedPayload);
                    break;
                }

                case 'event.account_switched': {
                    const switchedPayload = payload as unknown as AccountSwitchedPayload;
                    logger.info(`[WS] Account switch done: ${switchedPayload.email}`);
                    this.emit('accountSwitched', switchedPayload);
                    break;
                }

                case 'event.switch_error': {
                    const errorPayload = payload as unknown as SwitchErrorPayload;
                    logger.error(`[WS] Switch failed: ${errorPayload.message}`);
                    this.emit('switchError', errorPayload);
                    break;
                }

                case 'event.language_changed': {
                    const languagePayload = payload as unknown as LanguageChangedPayload;
                    logger.info(`[WS] Language changed: ${languagePayload.language}`);
                    this.emit('languageChanged', languagePayload);
                    break;
                }

                case 'event.wakeup_override': {
                    const overridePayload = payload as unknown as WakeupOverridePayload;
                    logger.info(`[WS] Wake exclusion status: enabled=${overridePayload.enabled}`);
                    this.emit('wakeupOverride', overridePayload);
                    break;
                }

                case 'event.plugin_set_switch_mode': {
                    const modePayload = payload as unknown as PluginSetSwitchModePayload;
                    logger.info(
                    `[WS] Received external switch mode request: request_id=${modePayload.request_id ?? 'none'}, mode=${modePayload.switch_mode ?? 'none'}`,
                    );
                    this.emit('pluginSetSwitchMode', modePayload);
                    break;
                }

                case 'event.plugin_switch_account': {
                    const switchPayload = payload as unknown as PluginSwitchAccountPayload;
                    logger.info(
                        `[WS] Received external account switch request: request_id=${switchPayload.request_id ?? 'none'}, target=${switchPayload.target_email ?? 'none'}, mode=${switchPayload.switch_mode ?? 'auto'}`,
                    );
                    this.emit('pluginSwitchAccount', switchPayload);
                    break;
                }

                case 'pong':
                    break;

                default:
                    logger.debug(`[WS] Unknown message type: ${message.type}`);
            }
        } catch (error) {
            logger.error('[WS] Failed to parse message:', error);
        }
    }
    
    private rejectAllPendingRequests(reason: string): void {
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(reason));
        }
        this.pendingRequests.clear();
    }

    private scheduleReconnect(): void {
        if (!this._shouldReconnect) {
            return;
        }

        if (this.reconnectTimer) {
            return;
        }


        const delay = Math.min(
            RECONNECT_INTERVAL + (this.reconnectFailCount * 5000),
            RECONNECT_INTERVAL_MAX,
        );
        
        logger.info(`[WS] Reconnecting in ${delay / 1000}s... (fail count: ${this.reconnectFailCount})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.doConnect();
        }, delay);
    }

    private startPing(): void {
        this.stopPing();
        this.pingTimer = setInterval(() => {
            this.send({ type: 'ping' });
        }, PING_INTERVAL);
    }

    private stopPing(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    private cleanup(): void {
        this.stopPing();
        this.rejectAllPendingRequests('Connection closed');

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            this.ws.close();
            this.ws = null;
        }

        this._isConnected = false;
        this._version = null;
    }
}

export const cockpitToolsWs = new CockpitToolsWsClient();
