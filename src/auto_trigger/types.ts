/**
 * Antigravity Cockpit - Auto Trigger Types
 *
 */

/**
 * OAuth
 */
export interface OAuthCredential {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    projectId?: string;
    isGcpTos?: boolean;
    scopes: string[];
    email?: string;
    /** True if refresh token is invalid (marked when refresh fails) */
    isInvalid?: boolean;
    /** True if account is forbidden (403 from cloud code) */
    isForbidden?: boolean;
}

/**
 * Account info for UI display (multi-account support)
 */
export interface AccountInfo {
    email: string;
    isActive: boolean;
    expiresAt?: string;
    /** True if refresh token is invalid (marked when refresh fails) */
    isInvalid?: boolean;
}

/**
 *
 */
export interface AuthorizationStatus {
    isAuthorized: boolean;
    email?: string;
    expiresAt?: string;
    lastRefresh?: string;
    /** All authorized accounts */
    accounts?: AccountInfo[];
    /** Currently active account email */
    activeAccount?: string;
}

/**
 *
 */
export type ScheduleRepeatMode = 'daily' | 'weekly' | 'interval';

/**
 *
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;  // 0 = Sunday

/**
 *
 */
export interface ScheduleConfig {
    enabled: boolean;
    repeatMode: ScheduleRepeatMode;

    dailyTimes?: string[];  // ["07:00", "12:00", "17:00"]

    weeklyDays?: number[];
    weeklyTimes?: string[];

    intervalHours?: number;
    intervalStartTime?: string;  // "07:00"
    intervalEndTime?: string;    // "22:00" (optional, omit for all day)


    crontab?: string;

    selectedModels: string[];

    selectedAccounts?: string[];

    wakeOnReset?: boolean;

    timeWindowEnabled?: boolean;

    timeWindowStart?: string;

    timeWindowEnd?: string;

    fallbackTimes?: string[];

    customPrompt?: string;

    maxOutputTokens?: number;
}

/**
 *
 */
export interface TriggerRecord {
    timestamp: string;  // ISO 8601
    success: boolean;
    prompt?: string;
    message?: string;
    duration?: number;  // ms
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    traceId?: string;
    triggerType?: 'manual' | 'auto';
    triggerSource?: 'manual' | 'scheduled' | 'crontab' | 'quota_reset';
    accountEmail?: string;
}

/**
 *
 */
export interface ModelInfo {
    id: string;
    displayName: string;
    modelConstant: string;
}

/**
 *
 */
export interface AutoTriggerState {
    authorization: AuthorizationStatus;
    schedule: ScheduleConfig;
    lastTrigger?: TriggerRecord;
    recentTriggers: TriggerRecord[];
    nextTriggerTime?: string;  // ISO 8601
    availableModels: ModelInfo[];
}

/**
 * Webview
 */
export interface AutoTriggerMessage {
    type:
    | 'auto_trigger_get_state'
    | 'auto_trigger_start_auth'
    | 'auto_trigger_revoke_auth'
    | 'auto_trigger_save_schedule'
    | 'auto_trigger_test_trigger'
    | 'auto_trigger_state_update';
    data?: {
        models?: string[];
        [key: string]: unknown;
    };
}

/**
 * Crontab
 */
export interface CrontabParseResult {
    valid: boolean;
    description?: string;
    nextRuns?: Date[];
    error?: string;
}

/**
 *
 */
export interface SchedulePreset {
    id: string;
    name: string;
    description: string;
    config: Partial<ScheduleConfig>;
}

/**
 *
 */
export const SCHEDULE_PRESETS: SchedulePreset[] = [
    {
        id: 'morning',
        name: 'Morning pre-trigger',
        description: 'Triggers once daily at 7:00 AM',
        config: {
            repeatMode: 'daily',
            dailyTimes: ['07:00'],
            selectedModels: ['gemini-3-flash'],
        },
    },
    {
        id: 'workday',
        name: 'Workday pre-trigger',
        description: 'Triggers at 8:00 AM on weekdays',
        config: {
            repeatMode: 'weekly',
            weeklyDays: [1, 2, 3, 4, 5],
            weeklyTimes: ['08:00'],
            selectedModels: ['gemini-3-flash'],
        },
    },
    {
        id: 'every4h',
        name: 'Every 4 hours',
        description: 'Starting at 7:00, triggers every 4 hours',
        config: {
            repeatMode: 'interval',
            intervalHours: 4,
            intervalStartTime: '07:00',
            intervalEndTime: '23:00',
            selectedModels: ['gemini-3-flash'],
        },
    },
];
