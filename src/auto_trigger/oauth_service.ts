/**
 * Antigravity Cockpit - OAuth Service
 * Google OAuth
 *
 */

import * as vscode from 'vscode';
import * as http from 'http';
import { URL } from 'url';
import { OAuthCredential } from './types';
import { credentialStorage } from './credential_storage';
import { logger } from '../shared/log_service';
import { t } from '../shared/i18n';


// NOTE: Set these via environment variables or VS Code secret storage in production.
const ANTIGRAVITY_CLIENT_ID = process.env['ANTIGRAVITY_CLIENT_ID'] ?? '';
const ANTIGRAVITY_CLIENT_SECRET = process.env['ANTIGRAVITY_CLIENT_SECRET'] ?? '';
const ANTIGRAVITY_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const CALLBACK_HOST_IPV4 = '127.0.0.1';
const CALLBACK_HOST_IPV6 = '::1';
const CALLBACK_PORT_START = 11451;
const CALLBACK_PORT_RANGE = 100;
const OAUTH_HTTP_TIMEOUT_MS = 15000;

/**
 * OAuth
 */
class OAuthService {
    private callbackServer?: http.Server;
    private callbackBaseUrl: string = `http://${CALLBACK_HOST_IPV4}`;
    private pendingAuth?: {
        state: string;
        resolve: (code: string) => void;
        reject: (error: Error) => void;
    };
    private pendingAuthSession?: {
        authUrl: string;
        redirectUri: string;
        promise: Promise<string>;
    };

    /**
     *
     * @returns
     */
    async startAuthorization(): Promise<boolean> {
        logger.info('[OAuthService] Starting authorization flow');

        try {

            const authUrl = await this.prepareAuthorizationSession();


            const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
            if (!opened) {
                logger.warn('[OAuthService] Failed to open browser, falling back to clipboard');
                try {
                    await vscode.env.clipboard.writeText(authUrl);
                } catch (copyError) {
                    logger.warn('[OAuthService] Failed to copy auth URL to clipboard', copyError);
                }
                vscode.window.showWarningMessage(t('oauth.browserOpenFailed'));
            }


            vscode.window.showInformationMessage(
                t('oauth.waiting'),
                t('common.cancel'),
            ).then(selection => {
                if (selection === t('common.cancel')) {
                    this.cancelPendingAuth();
                }
            });


            const session = this.pendingAuthSession;
            if (!session) {
                throw new Error('OAuth session not initialized');
            }
            const code = await session.promise;
            return await this.finalizeAuthorization(code, session.redirectUri);

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[OAuthService] Authorization failed: ${err.message}`);
            vscode.window.showErrorMessage(t('oauth.authFailed', { message: err.message }));
            return false;

        } finally {
            this.cancelAuthorizationSession();
        }
    }

    /**
     *
     */
    async prepareAuthorizationSession(): Promise<string> {
        if (this.pendingAuthSession) {
            return this.pendingAuthSession.authUrl;
        }

        const port = await this.startCallbackServer();
        const redirectUri = `${this.callbackBaseUrl}:${port}`;
        const state = this.generateState();
        const authUrl = this.buildAuthUrl(redirectUri, state);
        const promise = this.waitForCallback(state, 5 * 60 * 1000);
        promise.catch(() => undefined);

        this.pendingAuthSession = {
            authUrl,
            redirectUri,
            promise,
        };

        return authUrl;
    }

    /**
     *
     */
    async completeAuthorizationSession(): Promise<boolean> {
        if (!this.pendingAuthSession) {
            throw new Error('No pending OAuth session');
        }

        try {
            const { promise, redirectUri } = this.pendingAuthSession;
            const code = await promise;
            return await this.finalizeAuthorization(code, redirectUri);
        } finally {
            this.cancelAuthorizationSession();
        }
    }

    /**
     *
     */
    cancelAuthorizationSession(): void {
        this.cancelPendingAuth();
        this.pendingAuthSession = undefined;
    }

    /**
     *
     */
    async revokeAuthorization(): Promise<void> {
        await credentialStorage.deleteCredential();
        logger.info('[OAuthService] All authorizations revoked');
        vscode.window.showInformationMessage(t('oauth.allRevoked'));
    }

    /**
     *
     * @param email
     */
    async revokeAccount(email: string): Promise<void> {
        await credentialStorage.deleteCredentialForAccount(email);
        logger.info(`[OAuthService] Account ${email} revoked`);
        vscode.window.showInformationMessage(t('autoTrigger.accountRemoved', { email }));
    }

    /**
     *
     * @returns
     */
    async refreshAccessToken(): Promise<string | null> {
        const result = await this.refreshAccessTokenDetailed();
        if (result.state === 'ok') {
            return result.token ?? null;
        }
        return null;
    }

    /**
     *
     */
    async getValidAccessToken(): Promise<string | null> {
        const result = await this.getAccessTokenStatus();
        return result.state === 'ok' ? result.token ?? null : null;
    }

    async getAccessTokenStatus(): Promise<AccessTokenResult> {
        const credential = await credentialStorage.getCredential();
        if (!credential) {
            return { state: 'missing' };
        }


        const expiresAt = new Date(credential.expiresAt);
        const now = new Date();
        const bufferTime = 5 * 60 * 1000;
        const isExpired = expiresAt.getTime() <= now.getTime();

        if (expiresAt.getTime() - now.getTime() < bufferTime) {
            logger.info('[OAuthService] Token expiring soon, refreshing...');
            const refreshed = await this.refreshAccessTokenDetailed();
            if (refreshed.state === 'missing' && isExpired) {
                return { state: 'expired', error: 'Access token expired' };
            }
            return refreshed;
        }

        return { state: 'ok', token: credential.accessToken };
    }

    /**
     *
     */
    buildCredentialFromTokenData(params: {
        accessToken: string;
        refreshToken: string;
        expiresAt: string;
        email: string;
        projectId?: string;
        isInvalid?: boolean;
    }): OAuthCredential {
        return {
            clientId: ANTIGRAVITY_CLIENT_ID,
            clientSecret: ANTIGRAVITY_CLIENT_SECRET,
            accessToken: params.accessToken,
            refreshToken: params.refreshToken,
            expiresAt: params.expiresAt,
            projectId: params.projectId,
            scopes: ANTIGRAVITY_SCOPES,
            email: params.email,
            isInvalid: params.isInvalid ?? false,
        };
    }

    /**
     *
     *
     */
    async buildCredentialFromRefreshToken(refreshToken: string, fallbackEmail?: string): Promise<OAuthCredential> {
        try {
            const response = await this.fetchWithTimeout(TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: ANTIGRAVITY_CLIENT_ID,
                    client_secret: ANTIGRAVITY_CLIENT_SECRET,
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token',
                }).toString(),
            });

            if (!response.ok) {
                const errorText = await response.text();
                const lowered = errorText.toLowerCase();
                if (lowered.includes('invalid_grant')) {
                    throw new Error('refresh_token has expired (invalid_grant)');
                }
                throw new Error(`RefreshFailed: ${response.status} - ${errorText}`);
            }

            const data = await response.json() as {
                access_token: string;
                expires_in: number;
                scope?: string;
            };

            const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
            const scopes = data.scope ? data.scope.split(' ') : ANTIGRAVITY_SCOPES;

            let email = fallbackEmail;
            try {
                email = await this.fetchUserEmail(data.access_token);
            } catch (e) {
                const err = e instanceof Error ? e.message : String(e);
                logger.warn(`[OAuthService] Failed to fetch user email, using fallback: ${err}`);
            }

            if (!email) {
                throw new Error('Cannot determine account email, rejecting sync');
            }

            return {
                clientId: ANTIGRAVITY_CLIENT_ID,
                clientSecret: ANTIGRAVITY_CLIENT_SECRET,
                accessToken: data.access_token,
                refreshToken,
                expiresAt,
                scopes,
                email,
                projectId: undefined,
                isInvalid: false,
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[OAuthService] Failed to build credentials from refresh_token: ${err.message}`);
            throw err;
        }
    }

    /**
     *
     */
    async getAccessTokenStatusForAccount(email: string): Promise<AccessTokenResult> {
        const credential = await credentialStorage.getCredentialForAccount(email);
        if (!credential) {
            return { state: 'missing' };
        }


        const expiresAt = new Date(credential.expiresAt);
        const now = new Date();
        const bufferTime = 5 * 60 * 1000;
        const isExpired = expiresAt.getTime() <= now.getTime();

        if (expiresAt.getTime() - now.getTime() < bufferTime) {
            logger.info(`[OAuthService] Token expiring soon for ${email}, refreshing...`);
            const refreshed = await this.refreshAccessTokenDetailedForAccount(email);
            if (refreshed.state === 'missing' && isExpired) {
                return { state: 'expired', error: 'Access token expired' };
            }
            return refreshed;
        }

        return { state: 'ok', token: credential.accessToken };
    }

    /**
     *
     */
    private async startCallbackServer(): Promise<number> {
        return new Promise((resolve, reject) => {
            let port = CALLBACK_PORT_START;
            let attempts = 0;

            const tryListen = (host: string, onError: (err: NodeJS.ErrnoException) => void) => {
                const server = http.createServer((req, res) => {
                    this.handleCallback(req, res);
                });

                server.on('error', (err: NodeJS.ErrnoException) => {
                    server.close();
                    onError(err);
                });

                server.listen(port, host, () => {
                    this.callbackServer = server;
                    this.setCallbackHost(host);
                    logger.info(`[OAuthService] Callback server started on ${host}:${port}`);
                    resolve(port);
                });
            };

            const tryPort = () => {
                if (attempts >= CALLBACK_PORT_RANGE) {
                    reject(new Error('No available port for OAuth callback'));
                    return;
                }

                tryListen(CALLBACK_HOST_IPV4, (err) => {
                    if (err.code === 'EADDRINUSE') {
                        port++;
                        attempts++;
                        tryPort();
                        return;
                    }
                    if (err.code === 'EADDRNOTAVAIL' || err.code === 'EINVAL' || err.code === 'EACCES') {
                        tryListen(CALLBACK_HOST_IPV6, (v6Err) => {
                            if (v6Err.code === 'EADDRINUSE') {
                                port++;
                                attempts++;
                                tryPort();
                                return;
                            }
                            reject(v6Err);
                        });
                        return;
                    }
                    reject(err);
                });
            };

            tryPort();
        });
    }

    /**
     *
     */
    private stopCallbackServer(): void {
        if (this.callbackServer) {
            this.callbackServer.close();
            this.callbackServer = undefined;
            logger.info('[OAuthService] Callback server stopped');
        }
    }

    /**
     *
     */
    private handleCallback(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = new URL(req.url || '', this.callbackBaseUrl);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <html>
                <head><title>AuthorizationFailed</title></head>
                <body style="font-family: system-ui; text-align: center; padding: 50px;">
                    <h1>❌ AuthorizationFailed</h1>
                    <p>Error: ${error}</p>
                    <p>Please close this page and try again.</p>
                </body>
                </html>
            `);
            if (this.pendingAuth) {
                this.pendingAuth.reject(new Error(`OAuth error: ${error}`));
                this.pendingAuth = undefined;
            }
            return;
        }

        if (code && state && this.pendingAuth && this.pendingAuth.state === state) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <html>
                <head><title>AuthorizationSuccess</title></head>
                <body style="font-family: system-ui; text-align: center; padding: 50px;">
                    <h1>✅ AuthorizationSuccess！</h1>
                    <p>You can close this page and return to VS Code.</p>
                    <script>setTimeout(() => window.close(), 2000);</script>
                </body>
                </html>
            `);
            this.pendingAuth.resolve(code);
            this.pendingAuth = undefined;
        } else {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <html>
                <head><title>InvalidRequest</title></head>
                <body style="font-family: system-ui; text-align: center; padding: 50px;">
                    <h1>⚠️ InvalidRequest</h1>
                    <p>Please re-initiate authorization.</p>
                </body>
                </html>
            `);
        }
    }

    /**
     *
     */
    private waitForCallback(state: string, timeout: number): Promise<string> {
        return new Promise((resolve, reject) => {
            this.pendingAuth = { state, resolve, reject };

            setTimeout(() => {
                if (this.pendingAuth && this.pendingAuth.state === state) {
                    this.pendingAuth.reject(new Error('Authorization timeout'));
                    this.pendingAuth = undefined;
                    this.pendingAuthSession = undefined;
                    this.stopCallbackServer();
                }
            }, timeout);
        });
    }

    /**
     *
     */
    private cancelPendingAuth(): void {
        if (this.pendingAuth) {
            this.pendingAuth.reject(new Error('Authorization cancelled by user'));
            this.pendingAuth = undefined;
        }
        this.pendingAuthSession = undefined;
        this.stopCallbackServer();
    }

    /**
     *
     */
    private async finalizeAuthorization(code: string, redirectUri: string): Promise<boolean> {

        const credential = await this.exchangeCodeForToken(code, redirectUri);


        const email = await this.fetchUserEmail(credential.accessToken);
        credential.email = email;

        // 3. Check for duplicate account
        const isDuplicate = await credentialStorage.hasAccount(email);
        if (isDuplicate) {
            // Account exists - this is a re-authorization, update credentials
            logger.info(`[OAuthService] Account ${email} exists, updating credentials`);
            await credentialStorage.saveCredential(credential);
            await credentialStorage.clearAccountInvalid(email);
            vscode.window.showInformationMessage(t('oauth.reauthSuccess', { email }));
            return true;
        }


        const result = await credentialStorage.saveCredentialForAccount(email, credential);


        if (result === 'added') {
            vscode.window.showInformationMessage(t('oauth.authSuccess', { email }));
        }

        logger.info(`[OAuthService] Authorization successful: ${email}`);
        return true;
    }

    /**
     *
     */
    private generateState(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let state = '';
        for (let i = 0; i < 32; i++) {
            state += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return state;
    }

    private setCallbackHost(host: string): void {
        this.callbackBaseUrl = this.formatCallbackBaseUrl(host);
    }

    private formatCallbackBaseUrl(host: string): string {
        if (host.includes(':')) {
            return `http://[${host}]`;
        }
        return `http://${host}`;
    }

    /**
     *
     */
    private buildAuthUrl(redirectUri: string, state: string): string {
        const params = new URLSearchParams({
            client_id: ANTIGRAVITY_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: ANTIGRAVITY_SCOPES.join(' '),
            state: state,
            access_type: 'offline',
            prompt: 'consent',
            include_granted_scopes: 'true',
        });
        return `${AUTH_URL}?${params.toString()}`;
    }

    /**
     *
     */
    private async exchangeCodeForToken(code: string, redirectUri: string): Promise<OAuthCredential> {
        const response = await this.fetchWithTimeout(TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                code: code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }).toString(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
            scope: string;
            token_type: string;
        };

        if (!data.refresh_token) {
            throw new Error('No refresh_token received. Please try again.');
        }

        const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

        return {
            clientId: ANTIGRAVITY_CLIENT_ID,
            clientSecret: ANTIGRAVITY_CLIENT_SECRET,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: expiresAt,
            scopes: data.scope.split(' '),
        };
    }

    /**
     *
     */
    private async fetchUserEmail(accessToken: string): Promise<string> {
        const response = await this.fetchWithTimeout(USERINFO_URL, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch user info: ${response.status}`);
        }

        const data = await response.json() as { email: string };
        return data.email;
    }

    private async refreshAccessTokenDetailed(): Promise<AccessTokenResult> {
        const credential = await credentialStorage.getCredential();
        if (!credential || !credential.refreshToken) {
            logger.warn('[OAuthService] No refresh token available');
            return { state: 'missing' };
        }

        try {
            const response = await this.fetchWithTimeout(TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: ANTIGRAVITY_CLIENT_ID,
                    client_secret: ANTIGRAVITY_CLIENT_SECRET,
                    refresh_token: credential.refreshToken,
                    grant_type: 'refresh_token',
                }).toString(),
            });

            if (!response.ok) {
                const errorText = await response.text();
                const lowered = errorText.toLowerCase();
                if (lowered.includes('invalid_grant')) {
                    logger.warn('[OAuthService] Refresh token invalid (invalid_grant)');
                    // Mark the account as invalid
                    if (credential.email) {
                        await credentialStorage.markAccountInvalid(credential.email, true);
                    }
                    return { state: 'invalid_grant', error: errorText };
                }
                const message = `Token refresh failed: ${response.status} - ${errorText}`;
                logger.error(`[OAuthService] ${message}`);
                return { state: 'refresh_failed', error: message };
            }

            const data = await response.json() as {
                access_token: string;
                expires_in: number;
            };

            const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
            await credentialStorage.updateAccessToken(data.access_token, expiresAt);

            logger.info('[OAuthService] Access token refreshed');
            return { state: 'ok', token: data.access_token };

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[OAuthService] Token refresh failed: ${err.message}`);
            return { state: 'refresh_failed', error: err.message };
        }
    }

    private async refreshAccessTokenDetailedForAccount(email: string): Promise<AccessTokenResult> {
        const credential = await credentialStorage.getCredentialForAccount(email);
        if (!credential || !credential.refreshToken) {
            logger.warn(`[OAuthService] No refresh token available for ${email}`);
            return { state: 'missing' };
        }

        try {
            const response = await this.fetchWithTimeout(TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: ANTIGRAVITY_CLIENT_ID,
                    client_secret: ANTIGRAVITY_CLIENT_SECRET,
                    refresh_token: credential.refreshToken,
                    grant_type: 'refresh_token',
                }).toString(),
            });

            if (!response.ok) {
                const errorText = await response.text();
                const lowered = errorText.toLowerCase();
                if (lowered.includes('invalid_grant')) {
                    logger.warn(`[OAuthService] Refresh token invalid (invalid_grant) for ${email}`);
                    await credentialStorage.markAccountInvalid(email, true);
                    return { state: 'invalid_grant', error: errorText };
                }
                const message = `Token refresh failed: ${response.status} - ${errorText}`;
                logger.error(`[OAuthService] ${message}`);
                return { state: 'refresh_failed', error: message };
            }

            const data = await response.json() as {
                access_token: string;
                expires_in: number;
            };

            const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
            await credentialStorage.updateAccessTokenForAccount(email, data.access_token, expiresAt);

            logger.info(`[OAuthService] Access token refreshed for ${email}`);
            return { state: 'ok', token: data.access_token };

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[OAuthService] Token refresh failed for ${email}: ${err.message}`);
            return { state: 'refresh_failed', error: err.message };
        }
    }

    private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OAUTH_HTTP_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            return response;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('RequestTimeout');
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}

export const oauthService = new OAuthService();

export type AccessTokenState =
    | 'ok'
    | 'missing'
    | 'expired'
    | 'invalid_grant'
    | 'refresh_failed';

export interface AccessTokenResult {
    state: AccessTokenState;
    token?: string;
    error?: string;
}
