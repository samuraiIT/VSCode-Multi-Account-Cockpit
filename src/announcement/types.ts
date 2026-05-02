/**
 * Antigravity Cockpit - Announcement Types
 *
 */

export type AnnouncementType = 'feature' | 'warning' | 'info' | 'urgent';

export type AnnouncementActionType = 'tab' | 'url' | 'command';

export interface AnnouncementAction {
    type: AnnouncementActionType;
    target: string;
    label: string;
    arguments?: unknown[];
}

export interface AnnouncementActionOverride {
    targetVersions: string;
    action: AnnouncementAction | null;
}

export interface AnnouncementLocale {
    title?: string;
    summary?: string;
    content?: string;
    actionLabel?: string;
}

export interface AnnouncementImage {
    url: string;
    label?: string;
    alt?: string;
}

export interface Announcement {
    id: string;
    type: AnnouncementType;
    priority: number;
    title: string;
    summary: string;
    content: string;
    action?: AnnouncementAction | null;
    actionOverrides?: AnnouncementActionOverride[];
    targetVersions: string;
    targetLanguages?: string[];
    showOnce: boolean;
    popup: boolean;
    createdAt: string;
    expiresAt?: string | null;
    locales?: { [key: string]: AnnouncementLocale };
    images?: AnnouncementImage[];
}

export interface AnnouncementResponse {
    version: string;
    announcements: Announcement[];
}

export interface AnnouncementState {
    announcements: Announcement[];
    unreadIds: string[];
    popupAnnouncement: Announcement | null;
}
