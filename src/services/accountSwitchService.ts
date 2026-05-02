import * as vscode from 'vscode';
import { credentialStorage, oauthService } from '../auto_trigger';
import { configService } from '../shared/config_service';
import { logger } from '../shared/log_service';
import { getOfficialIdeVersion } from '../shared/official_host_version';
import { cockpitToolsLocal } from './cockpitToolsLocal';
import { cockpitToolsWs } from './cockpitToolsWs';

const ACCOUNT_SWITCH_MODE_STATE_KEY = 'accountSwitchMode';
const DEFAULT_WS_WAIT_MS = 5000;
const DEFAULT_SEAMLESS_TIMEOUT_MS = 8000;

export type AccountSwitchMode = 'default' | 'seamless';
export type AccountSwitchModeInput = AccountSwitchMode | 'auto';

export type AccountSwitchErrorCode =
    | 'tools_offline'
    | 'account_not_found'
    | 'switch_failed'
    | 'host_unavailable'
    | 'token_missing'
    | 'invalid_expiry'
    | 'unknown';

export interface AccountSwitchResult {
    success: boolean;
    mode: AccountSwitchMode;
    email?: string;
    message?: string;
    errorCode?: AccountSwitchErrorCode;
}

export interface AccountSwitchOptions {
    requestedMode?: AccountSwitchModeInput;
}

interface OAuthTokenInfoPayload {
    accessToken: string;
    refreshToken: string;
    expiryDateSeconds: number;
    tokenType: string;
    isGcpTos: boolean;
}

interface OAuthPreferencesApi {
    getOAuthTokenInfo?(): Promise<OAuthTokenInfoPayload | null> | Thenable<OAuthTokenInfoPayload | null>;
    setOAuthTokenInfo(tokenInfo: OAuthTokenInfoPayload | null): Promise<void> | Thenable<void>;
}

interface AntigravityUnifiedStateSyncApi {
    OAuthPreferences?: OAuthPreferencesApi;
}

interface AntigravityAuthApi extends OAuthPreferencesApi {}

interface AntigravityVsCodeApi {
    antigravityUnifiedStateSync?: AntigravityUnifiedStateSyncApi;
    antigravityAuth?: AntigravityAuthApi;
}

interface SeamlessApiSelection {
    tokenApi: OAuthPreferencesApi | null;
    apiName: 'OAuthPreferences' | 'antigravityAuth' | 'none';
    reason: string;
}

class AccountSwitchService {
    getMode(): AccountSwitchMode {
        const mode = configService.getStateValue<string>(ACCOUNT_SWITCH_MODE_STATE_KEY, 'default');
        if (mode === 'seamlessLegacy') {
            return 'seamless';
        }
        return mode === 'seamless' ? 'seamless' : 'default';
    }

    isSeamlessMode(mode: AccountSwitchMode = this.getMode()): boolean {
        return mode === 'seamless';
    }

    async setMode(mode: AccountSwitchMode): Promise<void> {
        await configService.setStateValue<AccountSwitchMode>(ACCOUNT_SWITCH_MODE_STATE_KEY, mode);
        logger.info(`[AccountSwitchService] Switch mode set to ${mode}`);
    }

    resolveRequestedMode(requestedMode?: AccountSwitchModeInput): AccountSwitchMode {
        if (requestedMode === 'default' || requestedMode === 'seamless') {
            return requestedMode;
        }
        return this.getMode();
    }

    async switchAccount(email: string, options?: AccountSwitchOptions): Promise<AccountSwitchResult> {
        const mode = this.resolveRequestedMode(options?.requestedMode);
        logger.info(`[AccountSwitchService] Switching ${email} with mode=${mode}`);
        if (mode === 'seamless') {
            return this.switchViaSeamless(email);
        }
        return this.switchViaDefault(email);
    }

    private async switchViaDefault(email: string): Promise<AccountSwitchResult> {
        try {
            if (!cockpitToolsWs.isConnected) {
                const connected = await cockpitToolsWs.waitForConnection(DEFAULT_WS_WAIT_MS);
                if (!connected) {
                    return {
                        success: false,
                        mode: 'default',
                        email,
                        errorCode: 'tools_offline',
                        message: 'Cockpit Tools not running or not connected',
                    };
                }
            }

            const accountId = cockpitToolsLocal.getAccountIdByEmail(email);
            if (!accountId) {
                return {
                    success: false,
                    mode: 'default',
                    email,
                    errorCode: 'account_not_found',
                    message: 'Account Tools ID not found',
                };
            }

            const result = await cockpitToolsWs.switchAccount(accountId);
            if (!result.success) {
                return {
                    success: false,
                    mode: 'default',
                    email,
                    errorCode: 'switch_failed',
                    message: result.message,
                };
            }

            await credentialStorage.setActiveAccount(email, true);
            return {
                success: true,
                mode: 'default',
                email,
            };
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            logger.warn(`[AccountSwitchService] Default switch failed: ${err}`);
            return {
                success: false,
                mode: 'default',
                email,
                errorCode: 'unknown',
                message: err,
            };
        }
    }

    private async switchViaSeamless(email: string): Promise<AccountSwitchResult> {
        const ideVersion = getOfficialIdeVersion();
        const selected = this.selectSeamlessApi();
        logger.info(
            `[AccountSwitchService] Seamless strategy: ideVersion=${ideVersion ?? 'unknown'}, selected=${selected.apiName}, reason=${selected.reason}`,
        );
        if (!selected.tokenApi || selected.apiName === 'none') {
            return {
                success: false,
                mode: 'seamless',
                email,
                errorCode: 'host_unavailable',
                message: `Seamless switch unavailable: host does not support switch interface (${selected.reason}), use default mode.`,
            };
        }
        return this.switchViaTokenApi(
            email,
            'seamless',
            selected.tokenApi,
            selected.apiName,
            selected.apiName === 'OAuthPreferences'
                ? 'Seamless switch unavailable: host does not support OAuthPreferences.setOAuthTokenInfo, switch to default mode.'
                : 'Seamless switch unavailable: host does not support antigravityAuth.setOAuthTokenInfo, use default mode.',
        );
    }

    private async switchViaTokenApi(
        email: string,
        mode: AccountSwitchMode,
        tokenApi: OAuthPreferencesApi | null,
        apiName: string,
        unavailableMessage: string,
    ): Promise<AccountSwitchResult> {
        const requestedEmail = email.trim();
        logger.info(`[AccountSwitchService] ${mode} switch start: requested=${requestedEmail}, api=${apiName}`);
        try {
            const resolvedEmail = await this.resolveCredentialEmail(requestedEmail);
            if (!resolvedEmail) {
                return {
                    success: false,
                    mode,
                    email: requestedEmail,
                    errorCode: 'account_not_found',
                    message: 'Local credentials not found for account',
                };
            }

            const activeBefore = await credentialStorage.getActiveAccount();
            logger.info(
                `[AccountSwitchService] Seamless target resolved: requested=${requestedEmail}, resolved=${resolvedEmail}, activeBefore=${activeBefore ?? 'none'}`,
            );

            const tokenStatus = await oauthService.getAccessTokenStatusForAccount(resolvedEmail);
            if (tokenStatus.state !== 'ok' || !tokenStatus.token) {
                const tokenMessage = this.buildSeamlessTokenErrorMessage(tokenStatus.state, tokenStatus.error);
                logger.warn(
                    `[AccountSwitchService] Seamless switch aborted for ${resolvedEmail}: tokenState=${tokenStatus.state}, error=${tokenStatus.error ?? 'none'}`,
                );
                return {
                    success: false,
                    mode,
                    email: resolvedEmail,
                    errorCode: tokenStatus.state === 'missing' ? 'token_missing' : 'switch_failed',
                    message: tokenMessage,
                };
            }

            const credential = await credentialStorage.getCredentialForAccount(resolvedEmail);
            if (!credential?.refreshToken) {
                return {
                    success: false,
                    mode,
                    email: resolvedEmail,
                    errorCode: 'token_missing',
                    message: 'Incomplete account credentials, missing refresh_token',
                };
            }

            const expiryMs = Date.parse(credential.expiresAt);
            if (Number.isNaN(expiryMs)) {
                return {
                    success: false,
                    mode,
                    email: resolvedEmail,
                    errorCode: 'invalid_expiry',
                    message: 'Account expiresAt invalid, cannot perform seamless switch',
                };
            }

            const accessToken = tokenStatus.token || credential.accessToken;
            if (!accessToken) {
                return {
                    success: false,
                    mode,
                    email: resolvedEmail,
                    errorCode: 'token_missing',
                    message: 'Incomplete account credentials, missing access_token',
                };
            }

            if (!tokenApi) {
                return {
                    success: false,
                    mode,
                    email: resolvedEmail,
                    errorCode: 'host_unavailable',
                    message: unavailableMessage,
                };
            }

            const tokenInfo: OAuthTokenInfoPayload = {
                accessToken,
                refreshToken: credential.refreshToken,
                expiryDateSeconds: Math.floor(expiryMs / 1000),
                tokenType: 'Bearer',
                isGcpTos: false,
            };

            await this.withTimeout(
                Promise.resolve(tokenApi.setOAuthTokenInfo(tokenInfo)),
                DEFAULT_SEAMLESS_TIMEOUT_MS,
                'setOAuthTokenInfo',
            );

            if (typeof tokenApi.getOAuthTokenInfo === 'function') {
                try {
                    const appliedToken = await this.withTimeout(
                        Promise.resolve(tokenApi.getOAuthTokenInfo()),
                        DEFAULT_SEAMLESS_TIMEOUT_MS,
                        'getOAuthTokenInfo',
                    );
                    logger.info(
                        `[AccountSwitchService] ${mode} host token updated for ${resolvedEmail}: tokenInHost=${appliedToken ? 'yes' : 'no'}, api=${apiName}`,
                    );
                } catch (readbackError) {
                    const err = readbackError instanceof Error ? readbackError.message : String(readbackError);
                    logger.warn(`[AccountSwitchService] ${mode} host token readback failed for ${resolvedEmail}: ${err}`);
                }
            }

            await credentialStorage.setActiveAccount(resolvedEmail, true);
            logger.info(
                `[AccountSwitchService] Seamless switch success: ${activeBefore ?? 'none'} -> ${resolvedEmail}`,
            );

            return {
                success: true,
                mode,
                email: resolvedEmail,
            };
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            logger.warn(`[AccountSwitchService] ${mode} switch failed: ${err}`);
            return {
                success: false,
                mode,
                email: requestedEmail,
                errorCode: 'unknown',
                message: err,
            };
        }
    }

    private buildSeamlessTokenErrorMessage(state: string, error?: string): string {
        switch (state) {
            case 'missing':
                return 'Local credentials not found, cannot perform seamless switch';
            case 'invalid_grant':
                return 'Account refresh_token has expired, please re-authorize before switching';
            case 'expired':
                return 'Account access_token has expired, please re-authorize before switching';
            case 'refresh_failed':
                return `Failed to refresh target account access_token: ${error || 'unknown error'}`;
            default:
                return error || 'Seamless switch failed: target account token unavailable';
        }
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`Seamless switch call timeout: ${stage}`));
            }, timeoutMs);
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    private async resolveCredentialEmail(email: string): Promise<string | null> {
        const accounts = await credentialStorage.getAllCredentials();
        const target = email.trim().toLowerCase();
        const matched = Object.keys(accounts).find((item) => item.trim().toLowerCase() === target);
        return matched ?? null;
    }

    private getUnifiedOAuthPreferences(): OAuthPreferencesApi | null {
        const api = vscode as unknown as AntigravityVsCodeApi;
        const prefs = api.antigravityUnifiedStateSync?.OAuthPreferences;
        return prefs && typeof prefs.setOAuthTokenInfo === 'function' ? prefs : null;
    }

    private getLegacyAuthApi(): OAuthPreferencesApi | null {
        const api = vscode as unknown as AntigravityVsCodeApi;
        const auth = api.antigravityAuth;
        return auth && typeof auth.setOAuthTokenInfo === 'function' ? auth : null;
    }

    private selectSeamlessApi(): SeamlessApiSelection {
        const unified = this.getUnifiedOAuthPreferences();
        const legacy = this.getLegacyAuthApi();

        if (unified && !legacy) {
            return { tokenApi: unified, apiName: 'OAuthPreferences', reason: 'only-unified-api-available' };
        }
        if (!unified && legacy) {
            return { tokenApi: legacy, apiName: 'antigravityAuth', reason: 'only-legacy-api-available' };
        }
        if (unified && legacy) {
            return { tokenApi: unified, apiName: 'OAuthPreferences', reason: 'both-available-prefer-unified' };
        }
        return { tokenApi: null, apiName: 'none', reason: 'no-supported-api' };
    }
}

export const accountSwitchService = new AccountSwitchService();
