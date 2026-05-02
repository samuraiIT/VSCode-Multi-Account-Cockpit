/**
 * Multi-Account Cockpit - i18n support
 * Supports 14 languages (Chinese removed).
 */

import * as vscode from 'vscode';
import { en, ja, es, de, fr, ptBR, ru, ko, it, tr, pl, cs, ar, vi } from './translations';

export type SupportedLocale =
    | 'en'
    | 'ja'
    | 'es'
    | 'de'
    | 'fr'
    | 'pt-br'
    | 'ru'
    | 'ko'
    | 'it'
    | 'tr'
    | 'pl'
    | 'cs'
    | 'ar'
    | 'vi';

export const localeDisplayNames: Record<SupportedLocale, string> = {
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'de': 'Deutsch',
    'fr': 'Français',
    'es': 'Español',
    'pt-br': 'Português (Brasil)',
    'ru': 'Русский',
    'it': 'Italiano',
    'tr': 'Türkçe',
    'pl': 'Polski',
    'cs': 'Čeština',
    'ar': 'اللغة العربية',
    'vi': 'Tiếng Việt',
};

interface TranslationMap {
    [key: string]: string;
}

const translations: Record<SupportedLocale, TranslationMap> = {
    'en': en,
    'ja': ja,
    'es': es,
    'de': de,
    'fr': fr,
    'pt-br': ptBR,
    'ru': ru,
    'ko': ko,
    'it': it,
    'tr': tr,
    'pl': pl,
    'cs': cs,
    'ar': ar,
    'vi': vi,
};

const localeMapping: Record<string, SupportedLocale> = {
    'en': 'en',
    'en-us': 'en',
    'en-gb': 'en',
    'ja': 'ja',
    'es': 'es',
    'de': 'de',
    'fr': 'fr',
    'pt-br': 'pt-br',
    'pt': 'pt-br',
    'ru': 'ru',
    'ko': 'ko',
    'it': 'it',
    'tr': 'tr',
    'pl': 'pl',
    'cs': 'cs',
    'ar': 'ar',
    'vi': 'vi',
    'vi-vn': 'vi',
};

export function normalizeLocaleInput(languageSetting: string): string {
    const trimmed = languageSetting.trim().toLowerCase();
    if (!trimmed || trimmed === 'auto') { return languageSetting; }
    if (localeMapping[trimmed]) { return localeMapping[trimmed]; }
    const prefix = trimmed.split('-')[0];
    if (localeMapping[prefix]) { return localeMapping[prefix]; }
    return trimmed;
}

class I18nService {
    private currentLocale: SupportedLocale = 'en';
    private manualLocale: string = 'auto';

    constructor() {
        this.detectLocale();
    }

    private detectLocale(): void {
        const vscodeLocale = vscode.env.language.toLowerCase();
        if (localeMapping[vscodeLocale]) {
            this.currentLocale = localeMapping[vscodeLocale];
            return;
        }
        const langPrefix = vscodeLocale.split('-')[0];
        if (localeMapping[langPrefix]) {
            this.currentLocale = localeMapping[langPrefix];
            return;
        }
        this.currentLocale = 'en';
    }

    applyLanguageSetting(languageSetting: string): boolean {
        const previousLocale = this.currentLocale;
        this.manualLocale = languageSetting;
        if (languageSetting === 'auto') {
            this.detectLocale();
        } else {
            const supportedLocales = Object.keys(translations) as SupportedLocale[];
            if (supportedLocales.includes(languageSetting as SupportedLocale)) {
                this.currentLocale = languageSetting as SupportedLocale;
            } else {
                this.detectLocale();
            }
        }
        return this.currentLocale !== previousLocale;
    }

    getManualLocale(): string { return this.manualLocale; }

    t(key: string, params?: Record<string, string | number>): string {
        const translation = translations[this.currentLocale]?.[key]
            || translations['en'][key]
            || key;
        if (!params) { return translation; }
        return Object.entries(params).reduce(
            (text, [paramKey, paramValue]) =>
                text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue)),
            translation,
        );
    }

    getLocale(): SupportedLocale { return this.currentLocale; }
    setLocale(locale: SupportedLocale): void { this.currentLocale = locale; }

    getAllTranslations(): TranslationMap {
        return { ...translations['en'], ...translations[this.currentLocale] };
    }

    getSupportedLocales(): SupportedLocale[] {
        return Object.keys(translations) as SupportedLocale[];
    }

    getLocaleDisplayName(locale: SupportedLocale): string {
        return localeDisplayNames[locale] || locale;
    }
}

export const i18n = new I18nService();
export const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
