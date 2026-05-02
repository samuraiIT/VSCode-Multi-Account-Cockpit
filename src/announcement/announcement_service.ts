/**
 * Antigravity Cockpit - Announcement Service
 *
 */

import * as vscode from 'vscode';
import { Announcement, AnnouncementResponse, AnnouncementState } from './types';
import { logger } from '../shared/log_service';
import { i18n } from '../shared/i18n';


const ANNOUNCEMENT_URL_PROD = 'https://raw.githubusercontent.com/jlcodes99/vscode-antigravity-cockpit/main/announcements.json';
const ANNOUNCEMENT_URL_DEV = 'https://raw.githubusercontent.com/jlcodes99/vscode-antigravity-cockpit/main/announcements_dev.json';

const READ_IDS_KEY = 'announcement_read_ids';
const CACHE_KEY = 'announcement_cache';
const CACHE_TTL = 3600 * 1000;

/**
 *
 */
function matchVersion(currentVersion: string, pattern: string): boolean {
    if (!pattern || pattern === '*') {return true;}
    
    const parseVersion = (v: string): number[] => {
        return v.replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
    };
    
    const current = parseVersion(currentVersion);
    
    const match = pattern.match(/^(>=|<=|>|<|=)?(.+)$/);
    if (!match) {return true;}
    
    const [, op = '=', ver] = match;
    const target = parseVersion(ver);
    
    for (let i = 0; i < 3; i++) {
        const c = current[i] || 0;
        const t = target[i] || 0;
        if (c !== t) {
            const cmp = c - t;
            switch (op) {
                case '>=': return cmp >= 0;
                case '<=': return cmp <= 0;
                case '>': return cmp > 0;
                case '<': return cmp < 0;
                default: return false;
            }
        }
    }
    
    return op === '>=' || op === '<=' || op === '=';
}

/**
 *
 */
class AnnouncementService {
    private context!: vscode.ExtensionContext;
    private currentVersion: string = '0.0.0';
    private cachedAnnouncements: Announcement[] = [];
    private initialized = false;
    private announcementUrl: string = ANNOUNCEMENT_URL_PROD;

    /**
     *
     */
    initialize(context: vscode.ExtensionContext): void {
        if (this.initialized) {return;}
        
        this.context = context;
        
        const ext = vscode.extensions.getExtension('jlcodes.antigravity-cockpit');
        this.currentVersion = ext?.packageJSON?.version || '0.0.0';
        
        const cached = context.globalState.get<{ time: number; data: Announcement[] }>(CACHE_KEY);
        if (cached?.data) {
            this.cachedAnnouncements = cached.data;
        }
        
        if (context.extensionMode === vscode.ExtensionMode.Development) {
            this.announcementUrl = ANNOUNCEMENT_URL_DEV;
            logger.info('[AnnouncementService] Using DEV announcement source');
        }
        
        this.initialized = true;
        logger.info(`[AnnouncementService] Initialized, version=${this.currentVersion}, url=${this.announcementUrl.includes('dev') ? 'DEV' : 'PROD'}`);
    }

    /**
     *
     */
    async fetchAnnouncements(): Promise<Announcement[]> {

        if (!this.initialized || !this.context) {
            logger.warn('[AnnouncementService] Not initialized, returning cached or empty');
            return this.filterAnnouncements(this.cachedAnnouncements);
        }

        const cached = this.context.globalState.get<{ time: number; data: Announcement[] }>(CACHE_KEY);
        if (cached && Date.now() - cached.time < CACHE_TTL) {
            logger.debug('[AnnouncementService] Using cached announcements');
            this.cachedAnnouncements = cached.data;
            return this.filterAnnouncements(cached.data);
        }

        try {
            logger.info('[AnnouncementService] Fetching announcements from remote...');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);


            const urlWithTimestamp = `${this.announcementUrl}?t=${Date.now()}`;
            const response = await fetch(urlWithTimestamp, {
                headers: { 
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                },
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json() as AnnouncementResponse;
            this.cachedAnnouncements = data.announcements || [];

            await this.context.globalState.update(CACHE_KEY, {
                time: Date.now(),
                data: this.cachedAnnouncements,
            });

            logger.info(`[AnnouncementService] Fetched ${this.cachedAnnouncements.length} announcements`);
            return this.filterAnnouncements(this.cachedAnnouncements);

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[AnnouncementService] Fetch failed: ${err.message}, using cache`);
            return this.filterAnnouncements(this.cachedAnnouncements);
        }
    }

    /**
     *
     */
    private filterAnnouncements(list: Announcement[]): Announcement[] {
        const now = Date.now();
        const locale = i18n.getLocale().toLowerCase(); // Use i18n locale (respects manual language setting)

        return list.filter(ann => {

            if (ann.targetVersions && ann.targetVersions !== '*') {
                if (!matchVersion(this.currentVersion, ann.targetVersions)) {
                    return false;
                }
            }


            if (ann.targetLanguages && ann.targetLanguages.length > 0) {
                const isAllLanguages = ann.targetLanguages.includes('*');
                if (!isAllLanguages) {

                    const isMatch = ann.targetLanguages.some(lang => 
                        lang.toLowerCase() === locale || locale.startsWith(lang.toLowerCase() + '-'),
                    );
                    if (!isMatch) {
                        return false;
                    }
                }
            }


            if (ann.expiresAt) {
                const expireTime = new Date(ann.expiresAt).getTime();
                if (expireTime < now) {
                    return false;
                }
            }

            return true;
        }).map(ann => {
            let localizedActionLabel: string | undefined;
            let localizedAnnouncement = ann;

            if (ann.locales) {
                const localeKey = Object.keys(ann.locales).find(k => 
                    k.toLowerCase() === locale || locale.startsWith(k.toLowerCase()),
                );

                if (localeKey && ann.locales[localeKey]) {
                    const localized = ann.locales[localeKey];
                    localizedActionLabel = localized.actionLabel;
                    localizedAnnouncement = {
                        ...ann,
                        title: localized.title || ann.title,
                        summary: localized.summary || ann.summary,
                        content: localized.content || ann.content,
                        action: ann.action ? {
                            ...ann.action,
                            label: localized.actionLabel || ann.action.label,
                        } : ann.action,
                    };
                }
            }
            const effectiveAction = this.resolveAnnouncementAction(localizedAnnouncement, localizedActionLabel);
            return {
                ...localizedAnnouncement,
                action: effectiveAction,
            };
        }).sort((a, b) => b.priority - a.priority);
    }

    private resolveAnnouncementAction(
        ann: Announcement,
        localizedActionLabel?: string,
    ): Announcement['action'] {
        let action = ann.action ?? null;
        if (ann.actionOverrides && ann.actionOverrides.length > 0) {
            const override = ann.actionOverrides.find(item =>
                matchVersion(this.currentVersion, item.targetVersions || '*'),
            );
            if (override) {
                action = override.action ? { ...override.action } : null;
            }
        }
        if (action && localizedActionLabel) {
            action = {
                ...action,
                label: localizedActionLabel,
            };
        }
        return action;
    }

    /**
     *
     */
    async getState(): Promise<AnnouncementState> {

        if (!this.initialized || !this.context) {
            logger.warn('[AnnouncementService] getState called before initialization');
            return {
                announcements: [],
                unreadIds: [],
                popupAnnouncement: null,
            };
        }

        const announcements = await this.fetchAnnouncements();
        const readIds = this.getReadIds();
        const unreadIds = announcements
            .filter(a => !readIds.includes(a.id))
            .map(a => a.id);

        const popupAnnouncement = announcements.find(
            a => a.popup && !readIds.includes(a.id),
        ) || null;

        return {
            announcements,
            unreadIds,
            popupAnnouncement,
        };
    }

    /**
     *
     */
    async getUnreadCount(): Promise<number> {
        const state = await this.getState();
        return state.unreadIds.length;
    }

    /**
     *
     */
    async markAsRead(id: string): Promise<void> {
        const ids = this.getReadIds();
        if (!ids.includes(id)) {
            ids.push(id);
            await this.context.globalState.update(READ_IDS_KEY, ids);
            logger.debug(`[AnnouncementService] Marked as read: ${id}`);
        }
    }

    /**
     *
     */
    async markAllAsRead(): Promise<void> {
        const announcements = await this.fetchAnnouncements();
        const ids = announcements.map(a => a.id);
        await this.context.globalState.update(READ_IDS_KEY, ids);
        logger.debug('[AnnouncementService] Marked all as read');
    }

    /**
     *
     */
    isRead(id: string): boolean {
        return this.getReadIds().includes(id);
    }

    /**
     *
     */
    private getReadIds(): string[] {
        return this.context.globalState.get<string[]>(READ_IDS_KEY) || [];
    }

    /**
     *
     */
    async clearCache(): Promise<void> {
        await this.context.globalState.update(CACHE_KEY, undefined);
        await this.context.globalState.update(READ_IDS_KEY, undefined);
        this.cachedAnnouncements = [];
        logger.info('[AnnouncementService] Cache cleared');
    }

    /**
     *
     */
    async forceRefresh(): Promise<AnnouncementState> {
        await this.context.globalState.update(CACHE_KEY, undefined);
        this.cachedAnnouncements = [];
        logger.info('[AnnouncementService] Force refreshing announcements...');
        return await this.getState();
    }
}

export const announcementService = new AnnouncementService();
