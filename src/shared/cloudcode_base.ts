/**
 * Cloud Code URL routing aligned with Antigravity desktop app.
 */

export const CLOUDCODE_URL_AUTOPUSH_SANDBOX = 'https://autopush-cloudcode-pa.sandbox.googleapis.com';
export const CLOUDCODE_URL_DAILY = 'https://daily-cloudcode-pa.googleapis.com';
export const CLOUDCODE_URL_PROD = 'https://cloudcode-pa.googleapis.com';

export interface CloudCodeRouteOptions {
    isGcpTos?: boolean;
    isGoogleInternal?: boolean;
    isInsiders?: boolean;
    isDev?: boolean;
    cloudCodeUrlOverride?: string;
}

function isAllowedCloudCodeOverrideHost(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase();
    return normalized === 'localhost'
        || normalized === '127.0.0.1'
        || normalized === '::1'
        || normalized.endsWith('.googleapis.com')
        || normalized === 'googleapis.com';
}

function sanitizeCloudCodeBaseUrl(rawUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Invalid Cloud Code base URL override: ${rawUrl}`);
    }

    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== '::1') {
        throw new Error(`Cloud Code base URL override must use HTTPS: ${rawUrl}`);
    }

    if (!isAllowedCloudCodeOverrideHost(parsed.hostname)) {
        throw new Error(`Cloud Code base URL override host is not allowed: ${parsed.hostname}`);
    }

    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
}

export function resolveCloudCodeBaseUrl(route?: CloudCodeRouteOptions): string {
    if (route?.cloudCodeUrlOverride) {
        return sanitizeCloudCodeBaseUrl(route.cloudCodeUrlOverride);
    }
    if (route?.isGcpTos) {
        return CLOUDCODE_URL_PROD;
    }
    if (route?.isGoogleInternal && (route.isInsiders || route.isDev)) {
        return CLOUDCODE_URL_AUTOPUSH_SANDBOX;
    }
    return CLOUDCODE_URL_DAILY;
}

export function buildCloudCodeUrl(baseUrl: string, path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
}
