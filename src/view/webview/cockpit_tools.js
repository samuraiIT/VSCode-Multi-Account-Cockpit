/**
 * Antigravity Cockpit - Cockpit Tools All Accounts Tab
 *
 * Renders a unified view of every account stored in ~/.antigravity_cockpit/:
 *   Antigravity AI, OpenAI Codex, Cursor, GitHub Copilot.
 *
 * Message protocol (extension → webview):
 *   { type: 'cockpitToolsUpdate', data: AllCockpitAccountsSnapshot }
 *
 * Message protocol (webview → extension):
 *   { type: 'getCockpitToolsAccounts' }
 *   { type: 'cockpitToolsImportCodex' }
 */

// eslint-disable-next-line no-redeclare
/* global acquireVsCodeApi */

(function () {
    'use strict';

    const vscode = window.__vscodeApi || (window.__vscodeApi = acquireVsCodeApi());

    // State

    let snapshot = null;
    let searchQuery = '';
    let filterProvider = 'all';
    let isLoading = true;
    let lastLoadedAt = null;

    // DOM refs — resolved lazily after the tab becomes visible

    function el(id) { return document.getElementById(id); }

    // Utilities

    function formatRelativeTime(tsMs) {
        if (!tsMs) return '';
        const diffMs = Date.now() - tsMs;
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 60) return 'just now';
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        const diffDay = Math.floor(diffHr / 24);
        return `${diffDay}d ago`;
    }

    function formatUnixTs(tsSeconds) {
        if (!tsSeconds) return '';
        // Detect milliseconds vs seconds (ms > year 2001 threshold)
        const ms = tsSeconds > 1e12 ? tsSeconds : tsSeconds * 1000;
        return formatRelativeTime(ms);
    }

    function planBadgeClass(plan) {
        if (!plan) return 'plan-free';
        const p = plan.toLowerCase();
        if (p === 'plus' || p === 'pro' || p === 'individual' || p === 'team') return 'plan-pro';
        if (p === 'ultra' || p === 'enterprise' || p === 'business') return 'plan-ultra';
        return 'plan-free';
    }

    function planLabel(plan) {
        if (!plan) return 'FREE';
        return plan.toUpperCase();
    }

    function providerColor(provider) {
        switch (provider) {
            case 'antigravity': return '#8b5cf6';
            case 'codex': return '#10a37f';
            case 'cursor': return '#3b82f6';
            case 'github_copilot': return '#e8761a';
            default: return '#6b7280';
        }
    }

    // Render

    function getFilteredSections() {
        if (!snapshot) return [];
        let sections = snapshot.sections;
        if (filterProvider !== 'all') {
            sections = sections.filter(s => s.provider === filterProvider);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            sections = sections.map(s => ({
                ...s,
                accounts: s.accounts.filter(a =>
                    a.email.toLowerCase().includes(q) ||
                    (a.displayName && a.displayName.toLowerCase().includes(q))
                ),
            })).filter(s => s.accounts.length > 0);
        }
        return sections;
    }

    function renderAccountCard(account, provider) {
        const currentBadge = account.isCurrent
            ? '<span class="ct-badge ct-badge-current">Active</span>'
            : '';
        const planStr = planLabel(account.plan);
        const planClass = planBadgeClass(account.plan);
        const timeStr = account.lastUsed ? formatUnixTs(account.lastUsed) : '';
        const displayName = account.displayName ? `<span class="ct-account-name">${escHtml(account.displayName)}</span>` : '';
        const timeHtml = timeStr ? `<span class="ct-account-time">${timeStr}</span>` : '';

        return `
<div class="ct-account-card" data-id="${escHtml(account.id)}" data-provider="${provider}">
    <div class="ct-account-avatar">${getInitial(account.email, account.displayName)}</div>
    <div class="ct-account-info">
        <div class="ct-account-email">${escHtml(account.email)}</div>
        ${displayName}
        <div class="ct-account-meta">
            ${currentBadge}
            <span class="ct-badge ${planClass}">${planStr}</span>
            ${timeHtml}
        </div>
    </div>
</div>`;
    }

    function getInitial(email, displayName) {
        const src = displayName || email || '?';
        return escHtml(src.charAt(0).toUpperCase());
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderSections(sections) {
        if (sections.length === 0) {
            return `
<div class="ct-empty-state">
    <div class="ct-empty-icon">📭</div>
    <div class="ct-empty-title">No accounts found</div>
    <div class="ct-empty-desc">
        ${searchQuery || filterProvider !== 'all'
            ? 'No accounts match the current filter.'
            : 'No accounts detected in Cockpit Tools data directory.'}
    </div>
</div>`;
        }

        return sections.map(section => {
            const color = providerColor(section.provider);
            const cards = section.accounts.map(a => renderAccountCard(a, section.provider)).join('');
            const currentCount = section.accounts.filter(a => a.isCurrent).length;
            const currentHint = currentCount > 0
                ? `<span class="ct-section-hint">${currentCount} active</span>`
                : '';

            return `
<div class="ct-section" data-provider="${section.provider}">
    <div class="ct-section-header" style="border-left-color:${color}">
        <span class="ct-section-icon">${section.icon}</span>
        <span class="ct-section-name">${escHtml(section.displayName)}</span>
        <span class="ct-section-count">${section.accounts.length}</span>
        ${currentHint}
    </div>
    <div class="ct-accounts-grid">
        ${cards}
    </div>
</div>`;
        }).join('');
    }

    function buildProviderFilterOptions() {
        if (!snapshot) return '';
        const options = [{ value: 'all', label: 'All providers' }];
        snapshot.sections.forEach(s => {
            options.push({ value: s.provider, label: `${s.icon} ${s.displayName}` });
        });
        return options.map(o =>
            `<option value="${o.value}"${filterProvider === o.value ? ' selected' : ''}>${escHtml(o.label)}</option>`
        ).join('');
    }

    function render() {
        const container = el('ct-content');
        if (!container) return;

        if (isLoading) {
            container.innerHTML = `
<div class="ct-loading">
    <span class="spinner"></span>
    <span>Loading Cockpit Tools accounts...</span>
</div>`;
            return;
        }

        if (!snapshot) {
            container.innerHTML = `
<div class="ct-empty-state">
    <div class="ct-empty-icon">⚠️</div>
    <div class="ct-empty-title">Could not load accounts</div>
    <div class="ct-empty-desc">Check that Cockpit Tools is installed and has accounts configured.</div>
</div>`;
            return;
        }

        // Update header counts
        const totalEl = el('ct-total-count');
        if (totalEl) totalEl.textContent = String(snapshot.totalAccounts);

        // Update provider filter options
        const filterEl = el('ct-filter-provider');
        if (filterEl) filterEl.innerHTML = buildProviderFilterOptions();

        // Update last refreshed time
        const refreshedEl = el('ct-last-refreshed');
        if (refreshedEl && lastLoadedAt) {
            refreshedEl.textContent = `Refreshed ${formatRelativeTime(lastLoadedAt)}`;
        }

        const sections = getFilteredSections();
        container.innerHTML = renderSections(sections);
    }

    // Actions

    function requestRefresh() {
        isLoading = true;
        render();
        vscode.postMessage({ command: 'getCockpitToolsAccounts' });
    }

    function triggerImport() {
        vscode.postMessage({ command: 'cockpitToolsImportCodex' });
    }

    // Event listeners

    function setupListeners() {
        const refreshBtn = el('ct-refresh-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', requestRefresh);

        const importBtn = el('ct-import-btn');
        if (importBtn) importBtn.addEventListener('click', triggerImport);

        const searchInput = el('ct-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                searchQuery = this.value.trim();
                render();
            });
        }

        const filterSelect = el('ct-filter-provider');
        if (filterSelect) {
            filterSelect.addEventListener('change', function () {
                filterProvider = this.value;
                render();
            });
        }
    }

    // Message handler (extension → webview)

    window.addEventListener('message', function (event) {
        const msg = event.data;
        if (!msg || !msg.type) return;

        if (msg.type === 'cockpitToolsUpdate') {
            snapshot = msg.data || null;
            lastLoadedAt = snapshot ? snapshot.loadedAt : Date.now();
            isLoading = false;
            render();
        }

        // Re-render when the cockpit tab becomes visible
        if (msg.type === 'switchTab' && msg.tab === 'cockpit') {
            requestRefresh();
        }

        if (msg.type === 'panelRevealed') {
            // Request fresh data when panel is first shown
            if (!snapshot) {
                requestRefresh();
            }
        }
    });

    // Initialise when DOM is ready

    function init() {
        setupListeners();
        // Kick off initial data load
        requestRefresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for tab-switch trigger from dashboard.js
    window.__cockpitToolsModule = {
        refresh: requestRefresh,
    };
})();
