/**
 * Antigravity Cockpit - Shared Authentication UI
 *
 */

(function () {
    'use strict';

    const i18n = window.__i18n || {};
    const t = (key) => i18n[key] || key;

    class AuthenticationUI {
        constructor(vscodeApi) {
            this.vscode = vscodeApi;
            this.state = {
                authorization: null,
                antigravityToolsSyncEnabled: false
            };
            this.elements = {};
        }

        updateState(authorization, antigravityToolsSyncEnabled) {
            this.state.authorization = authorization;
            if (antigravityToolsSyncEnabled !== undefined) {
                // Auto sync is intentionally forced off in UI.
                this.state.antigravityToolsSyncEnabled = false;
            }
        }

        /**
         *
         * @param {HTMLElement} container
         * @param {Object} options
         * @param {boolean} options.showSyncToggleInline
         */
        renderAuthRow(container, options = {}) {
            if (!container) return;

            const { authorization } = this.state;
            const accounts = authorization?.accounts || [];
            const hasAccounts = accounts.length > 0;
            const activeAccount = authorization?.activeAccount;
            const activeEmail = activeAccount || (hasAccounts ? accounts[0].email : null);
            const isAuthorized = authorization?.isAuthorized || hasAccounts;


            const overviewBtn = `<button class="quota-account-overview-btn" title="${t('accountsOverview.openBtn') || 'Accounts Overview'}">📊 ${t('accountsOverview.openBtn') || 'Accounts Overview'}</button>`;

            // Sync UI Elements
            let syncActionsHtml = '';

            if (options.showSyncToggleInline) {
                // Inline Style (Like Auto Trigger Tab)
                syncActionsHtml = `
                    <button class="at-btn at-btn-secondary at-import-btn">${t('autoTrigger.importFromAntigravityTools')}</button>
                `;
            } else {
                // Compact Style (Like Dashboard Tab)
                syncActionsHtml = `
                    <button class="at-btn at-btn-primary at-sync-config-btn" title="${t('atSyncConfig.title') || 'AccountSyncConfiguration'}">
                        ⚙ ${t('atSyncConfig.btnText') || 'AccountSyncConfiguration'}
                    </button>
                `;
            }

            if (isAuthorized && activeEmail) {
                const extraCount = Math.max(accounts.length - 1, 0);
                const accountCountBadge = extraCount > 0
                    ? `<span class="account-count-badge" title="${t('autoTrigger.manageAccounts')}">+${extraCount}</span>`
                    : '';

                const switchToClientBtn = `<button class="quota-account-manage-btn at-switch-to-client-btn" title="${t('autoTrigger.switchToClientAccount')}">${t('autoTrigger.switchToClientAccount')}</button>`;

                container.innerHTML = `
                    <div class="quota-auth-info quota-auth-info-clickable" title="${t('autoTrigger.manageAccounts')}">
                        <span class="quota-auth-email">${activeEmail}</span>
                        ${accountCountBadge}
                        ${overviewBtn}
                        ${switchToClientBtn}
                    </div>
                    <div class="quota-auth-actions">
                        ${syncActionsHtml}
                    </div>
                 `;
            } else {
                // Unauthorized
                container.innerHTML = `
                    <div class="quota-auth-info">
                        <span class="quota-auth-icon">⚠️</span>
                        <span class="quota-auth-text">${t('autoTrigger.unauthorized') || 'Unauthorized'}</span>
                    </div>
                    <div class="quota-auth-actions">
                        ${syncActionsHtml}
                        <button class="at-btn at-btn-primary at-authorize-btn">${t('autoTrigger.authorizeBtn') || 'Authorize'}</button>
                    </div>
                `;
            }

            this._bindEvents(container);
        }

        _bindEvents(container) {
            // Bind generic events
            const postMessage = (msg) => this.vscode.postMessage(msg);

            // Manage Accounts / Click Info
            container.querySelector('.quota-auth-info-clickable')?.addEventListener('click', () => {
                this.openAccountManageModal();
            });
            container.querySelector('.quota-account-overview-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const tabBtn = document.querySelector('.tab-btn[data-tab="accounts"]');
                if (tabBtn) {
                     tabBtn.click();
                } else {
                     this.vscode.postMessage({ command: 'executeCommand', commandId: 'agCockpit.openAccountsOverview' });
                }
            });

            // Authorize
            container.querySelector('.at-authorize-btn')?.addEventListener('click', () => {
                this.openLoginChoiceModal();
            });

            // Sync Config (Compact Mode)
            container.querySelector('.at-sync-config-btn')?.addEventListener('click', () => {
                this.openSyncConfigModal();
            });

            // Inline Sync Toggle
            // Inline Import
            container.querySelector('.at-import-btn')?.addEventListener('click', () => {
                postMessage({ command: 'antigravityToolsSync.import' });
            });


            container.querySelector('.at-switch-to-client-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                postMessage({ command: 'antigravityToolsSync.switchToClient' });
            });

            // Import local credential (moved to sync config modal)
        }

        // ============ Modals ============

        openAccountManageModal() {
            let modal = document.getElementById('account-manage-modal');
            if (!modal) {
                modal = this._createModal('account-manage-modal', `
                    <div class="modal-content account-manage-content">
                        <div class="modal-header">
                            <h3>${t('autoTrigger.manageAccounts') || 'Manage Accounts'}</h3>
                            <button class="close-btn" id="close-account-manage-modal">×</button>
                        </div>
                        <div class="modal-hint" style="padding: 8px 16px; font-size: 12px; color: var(--text-muted); background: var(--bg-secondary); border-bottom: 1px solid var(--border-color);">
                            <span style="margin-right: 12px;">💡 ${t('autoTrigger.manageAccountsHintClick') || 'Click email to switch quota view'}</span>
                            <span>🔄 ${t('autoTrigger.manageAccountsHintSwitch') || 'Click "Switch Login" to change client login account'}</span>
                        </div>
                        <div class="modal-body" id="account-manage-body"></div>
                        <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end;">
                            <button id="add-new-account-btn" class="at-btn at-btn-primary">
                                ➕ ${t('autoTrigger.addAccount') || 'Add Account'}
                            </button>
                        </div>
                    </div>
                `);

                // Bind Modal specific static events (close, add)
                document.getElementById('close-account-manage-modal')?.addEventListener('click', () => modal.classList.add('hidden'));
                document.getElementById('add-new-account-btn')?.addEventListener('click', () => {
                    this.vscode.postMessage({ command: 'autoTrigger.addAccount' });
                });
            }

            this.renderAccountManageList();
            modal.classList.remove('hidden');
        }

        renderAccountManageList() {
            const body = document.getElementById('account-manage-body');
            if (!body) return;

            const accounts = this.state.authorization?.accounts || [];
            const activeAccount = this.state.authorization?.activeAccount;

            if (accounts.length === 0) {
                body.innerHTML = `<div class="account-manage-empty">${t('autoTrigger.noAccounts') || 'No accounts authorized'}</div>`;
                return;
            }

            body.innerHTML = `<div class="account-manage-list">${accounts.map(acc => {
                const isActive = acc.email === activeAccount;
                const isInvalid = acc.isInvalid === true;
                const icon = isInvalid ? '⚠️' : (isActive ? '✅' : '👤');
                const badges = [
                    isActive && !isInvalid ? `<span class="account-manage-badge">${t('autoTrigger.accountActive')}</span>` : '',
                    isInvalid ? `<span class="account-manage-badge expired">${t('autoTrigger.tokenExpired')}</span>` : ''
                ].join('');

                const switchLoginBtn = `<button class="at-btn at-btn-small at-btn-primary account-switch-login-btn" data-email="${acc.email}">${t('autoTrigger.switchLoginBtn') || 'Switch Login'}</button>`;

                return `
                    <div class="account-manage-item ${isActive ? 'active' : ''} ${isInvalid ? 'expired' : ''}" data-email="${acc.email}">
                        <div class="account-manage-info">
                            <span class="account-manage-icon">${icon}</span>
                            <span class="account-manage-email">${acc.email}</span>
                            ${badges}
                        </div>
                        <div class="account-manage-actions">
                            ${switchLoginBtn}
                            <button class="at-btn at-btn-small at-btn-danger account-remove-btn" data-email="${acc.email}">${t('autoTrigger.deleteBtn') || 'Deleting'}</button>
                        </div>
                    </div>
                `;
            }).join('')}</div>`;

            body.querySelectorAll('.account-manage-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
                    if (item.classList.contains('active')) return;
                    const email = item.dataset.email;
                    if (email) {
                        this.vscode.postMessage({ command: 'autoTrigger.switchAccount', email });
                        document.getElementById('account-manage-modal')?.classList.add('hidden');
                    }
                });
            });

            body.querySelectorAll('.account-switch-login-btn').forEach(btn =>
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const email = btn.dataset.email;
                    if (email) {
                        this.showSwitchLoginConfirmModal(email);
                    }
                })
            );

            body.querySelectorAll('.account-remove-btn').forEach(btn =>
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (typeof window.openRevokeModalForEmail === 'function') {
                        window.openRevokeModalForEmail(btn.dataset.email);
                    } else {
                        this.vscode.postMessage({ command: 'autoTrigger.removeAccount', email: btn.dataset.email });
                    }
                })
            );
        }

        /**
         *
         */
        showSwitchLoginConfirmModal(email) {
            let modal = document.getElementById('switch-login-confirm-modal');
            if (!modal) {
                modal = this._createModal('switch-login-confirm-modal', `
                    <div class="modal-content" style="max-width: 400px;">
                        <div class="modal-header">
                            <h3>${t('autoTrigger.switchLoginTitle') || 'Switch Login Account'}</h3>
                            <button class="close-btn" id="switch-login-confirm-close">×</button>
                        </div>
                        <div class="modal-body" style="padding: 20px;">
                            <p style="margin-bottom: 10px;">${t('autoTrigger.switchLoginConfirmText') || 'Switch to the following account?'}</p>
                            <p style="font-weight: bold; color: var(--accent-color); margin-bottom: 15px;" id="switch-login-target-email"></p>
                            <p style="color: var(--warning-color); font-size: 0.9em;">⚠️ ${t('autoTrigger.switchLoginWarning') || 'This will restart Antigravity client to complete account switch.'}</p>
                        </div>
                        <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end; padding: 15px 20px;">
                            <button class="at-btn at-btn-secondary" id="switch-login-confirm-cancel">${t('common.cancel') || 'Cancel'}</button>
                            <button class="at-btn at-btn-primary" id="switch-login-confirm-ok">${t('common.confirm') || 'Confirm'}</button>
                        </div>
                    </div>
                `);

                document.getElementById('switch-login-confirm-close')?.addEventListener('click', () => modal.classList.add('hidden'));
                document.getElementById('switch-login-confirm-cancel')?.addEventListener('click', () => modal.classList.add('hidden'));
            }

            document.getElementById('switch-login-target-email').textContent = email;

            const okBtn = document.getElementById('switch-login-confirm-ok');
            const newOkBtn = okBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOkBtn, okBtn);
            newOkBtn.addEventListener('click', () => {
                modal.classList.add('hidden');
                this.vscode.postMessage({ command: 'autoTrigger.switchLoginAccount', email });
                document.getElementById('account-manage-modal')?.classList.add('hidden');
            });

            modal.classList.remove('hidden');
        }

        openSyncConfigModal() {
            let modal = document.getElementById('at-sync-config-modal');
            if (!modal) {
                modal = this._createModal('at-sync-config-modal', `
                    <div class="modal-content at-sync-config-content">
                        <div class="modal-header">
                        <h3>⚙ ${t('atSyncConfig.title') || 'AccountSyncConfiguration'}</h3>
                            <button class="close-btn" id="close-at-sync-config-modal">×</button>
                        </div>
                        <div class="modal-body at-sync-config-body">
                            <div class="at-sync-section at-sync-info-section">
                                <details class="at-sync-details at-sync-info-details">
                                    <summary class="at-sync-details-summary">
                                        <div class="at-sync-section-title-row">
                                            <div class="at-sync-section-title">ℹ️ ${t('atSyncConfig.featureTitle') || 'Feature Description'}</div>
                                            <span class="at-sync-details-link">
                                                ${t('atSyncConfig.dataAccessDetails') || 'Expand details'}
                                            </span>
                                        </div>
                                        <div class="at-sync-description at-sync-info-summary">${t('atSyncConfig.featureSummary') || 'View data access and sync/import rules.'}</div>
                                    </summary>
                                    <div class="at-sync-details-body">
                                        <div class="at-sync-info-block">
                                            <div class="at-sync-info-subtitle">🛡️ ${t('atSyncConfig.dataAccessTitle') || 'Data Access Info'}</div>
                                            <div class="at-sync-description">${t('atSyncConfig.dataAccessDesc') || 'This feature reads your local Antigravity Tools and client account info, used only for plugin authorization/switching.'}</div>
                                            <div class="at-sync-path-info">
                                                <span class="at-sync-path-label">${t('atSyncConfig.readPathTools') || 'Antigravity Tools Path'}:</span>
                                                <code class="at-sync-path">~/.antigravity_tools/</code>
                                            </div>
                                            <div class="at-sync-path-info">
                                                <span class="at-sync-path-label">${t('atSyncConfig.readPathLocal') || 'Antigravity Client Path'}:</span>
                                                <code class="at-sync-path">.../Antigravity/User/globalStorage/state.vscdb</code>
                                            </div>
                                            <div class="at-sync-data-list">
                                                <span class="at-sync-data-label">${t('atSyncConfig.readData') || 'Data Read'}:</span>
                                                <span class="at-sync-data-items">${t('atSyncConfig.readDataItems') || 'Account Email, Refresh Token (local read)'}</span>
                                            </div>
                                        </div>
                                        <div class="at-sync-info-block">
                                            <div class="at-sync-info-line">
                                                <span class="at-sync-info-label">${t('atSyncConfig.manualImportTitle') || 'Manual Import'}：</span>
                                                <span class="at-sync-info-text">${t('atSyncConfig.manualImportDesc') || 'Import local or Antigravity Tools accounts separately, one-time operation.'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </details>
                        </div>
                            <div class="at-sync-section">
                                <div class="at-sync-section-title">📥 ${t('atSyncConfig.manualImportTitle') || 'Manual Import'}</div>
                                <div class="at-sync-import-actions">
                                    <button id="at-sync-modal-import-local-btn" class="at-btn at-btn-primary at-sync-import-btn">${t('atSyncConfig.importLocal') || 'Import Local Account'}</button>
                                    <button id="at-sync-modal-import-tools-btn" class="at-btn at-btn-primary at-sync-import-btn">${t('atSyncConfig.importTools') || 'Import Antigravity Tools Account'}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `);
                document.getElementById('close-at-sync-config-modal')?.addEventListener('click', () => modal.classList.add('hidden'));

                modal.querySelector('#at-sync-modal-import-local-btn')?.addEventListener('click', () => {
                    if (typeof window.showLocalAuthImportLoading === 'function') {
                        window.showLocalAuthImportLoading();
                    }
                    this.vscode.postMessage({ command: 'autoTrigger.importLocal' });
                    modal.classList.add('hidden');
                });
                modal.querySelector('#at-sync-modal-import-tools-btn')?.addEventListener('click', () => {
                    this.vscode.postMessage({ command: 'antigravityToolsSync.import' });
                    modal.classList.add('hidden');
                });
            }

            modal.querySelectorAll('.at-sync-details').forEach((detail) => {
                detail.removeAttribute('open');
            });

            modal.classList.remove('hidden');
        }

        openLoginChoiceModal() {
            let modal = document.getElementById('auth-choice-modal');
            if (!modal) {
                modal = this._createModal('auth-choice-modal', `
                    <div class="modal-content auth-choice-content">
                        <div class="modal-header">
                            <h3>${t('authChoice.title') || 'Select Login Method'}</h3>
                            <button class="close-btn" id="close-auth-choice-modal">×</button>
                        </div>
                        <div class="modal-body auth-choice-body">
                            <div class="auth-choice-info">
                                <div class="auth-choice-desc">${t('authChoice.desc') || 'Choose to read local authorized account or authorize via OAuth.'}</div>
                                <div class="auth-choice-tip">${t('authChoice.tip') || 'OAuth login for headless use; local read applies to current machine only.'}</div>
                            </div>
                            <div class="auth-choice-grid">
                                <div class="auth-choice-card">
                                    <div class="auth-choice-header">
                                        <span class="auth-choice-icon">🖥️</span>
                                        <div>
                                            <div class="auth-choice-title">${t('authChoice.localTitle') || 'Read Local Authorized Account'}</div>
                                            <div class="auth-choice-text">${t('authChoice.localDesc') || 'Read locally authorized account from Antigravity client, reuses existing authorization.'}</div>
                                        </div>
                                    </div>
                                    <button id="auth-choice-local-btn" class="at-btn at-btn-primary auth-choice-btn">
                                        ${t('authChoice.localBtn') || 'Read Local Authorization'}
                                    </button>
                                </div>
                                <div class="auth-choice-card">
                                    <div class="auth-choice-header">
                                        <span class="auth-choice-icon">🔐</span>
                                        <div>
                                            <div class="auth-choice-title">${t('authChoice.oauthTitle') || 'OAuth Login (Cloud Authorization)'}</div>
                                            <div class="auth-choice-text">${t('authChoice.oauthDesc') || 'New authorization via Google OAuth, for headless use, revocable.'}</div>
                                        </div>
                                    </div>
                                    <button id="auth-choice-oauth-btn" class="at-btn at-btn-primary auth-choice-btn">
                                        ${t('authChoice.oauthBtn') || 'Go Authorize'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `);
                document.getElementById('close-auth-choice-modal')?.addEventListener('click', () => modal.classList.add('hidden'));
                modal.querySelector('#auth-choice-oauth-btn')?.addEventListener('click', () => {
                    this.vscode.postMessage({ command: 'autoTrigger.authorize' });
                    modal.classList.add('hidden');
                });
                modal.querySelector('#auth-choice-local-btn')?.addEventListener('click', () => {
                    if (typeof window.showLocalAuthImportLoading === 'function') {
                        window.showLocalAuthImportLoading();
                    }
                    this.vscode.postMessage({ command: 'autoTrigger.importLocal' });
                    modal.classList.add('hidden');
                });
            }

            modal.classList.remove('hidden');
        }

        _createModal(id, html) {
            const modal = document.createElement('div');
            modal.id = id;
            modal.className = 'modal hidden';
            modal.innerHTML = html;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
            return modal;
        }
    }

    // Export to window
    window.AntigravityAuthUI = AuthenticationUI;

})();
