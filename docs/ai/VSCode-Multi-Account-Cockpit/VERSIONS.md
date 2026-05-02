# Versions

## 20260503-015100-backup-config-alignment

- Base commit: `d10f7ff`
- Status: `completed`
- Scope:
  - isolated backup manager contract changes into a dedicated slice
  - aligned enablement and retention with `multiCockpit.backup.*`
  - preserved legacy path/interval compatibility for imported upstream behavior
  - added backup target and retention regression coverage
- Changed source files:
  - `src/storage_manager/backup.ts`
  - `src/storage_manager/backup.test.ts`
- Backup:
  - `docs/ai/VSCode-Multi-Account-Cockpit/backups/20260503-015100-backup-config-alignment/changed-files.patch`
  - `docs/ai/VSCode-Multi-Account-Cockpit/backups/20260503-015100-backup-config-alignment/rollback.md`

## 20260503-014616-cockpit-tools-provider-expansion

- Base commit: `7dfbf69`
- Status: `completed`
- Scope:
  - isolated Cockpit Tools provider expansion into a standalone commit slice
  - generalized account snapshot loading for current provider index files
  - added regression coverage for shared current-account state and malformed provider files
- Changed source files:
  - `src/services/cockpitToolsAllAccounts.ts`
  - `src/services/cockpitToolsAllAccounts.test.ts`
- Backup:
  - `docs/ai/VSCode-Multi-Account-Cockpit/backups/20260503-014616-cockpit-tools-provider-expansion/changed-files.patch`
  - `docs/ai/VSCode-Multi-Account-Cockpit/backups/20260503-014616-cockpit-tools-provider-expansion/rollback.md`

## 20260503-000812-security-hardening-wave-1

- Base commit: `1513f7cd2ecb5b24f56371bf882db596aa86fcb0`
- Status: `completed`
- Scope:
  - validated security finding remediation wave
  - OAuth callback CSRF hardening for Google Drive auth
  - announcement/webview command-bridge hardening
  - stored XSS mitigation in sync stats rendering path
  - import-path and local-storage path traversal hardening
  - Telegram auth hardening for username-configured deployments
- Changed source files:
  - `src/controller/message_controller.ts`
  - `src/services/importService.ts`
  - `src/storage_manager/googleAuth.ts`
  - `src/storage_manager/googleDrive.ts`
  - `src/storage_manager/localStorage.ts`
  - `src/storage_manager/quota/syncStatsWebview.ts`
  - `src/storage_manager/sync.ts`
  - `src/storage_manager/telegram/telegramService.ts`
  - `src/shared/cloudcode_base.ts`
  - `src/view/webview/accounts_overview.js`
  - `src/view/webview/dashboard_announcements.js`
  - `tsconfig.json`
- Backup:
  - `docs/ai/VSCode-Multi-Account-Cockpit/backups/20260503-000812-security-hardening-wave-1/pre-change-working-tree.patch`
  - `docs/ai/VSCode-Multi-Account-Cockpit/backups/20260503-000812-security-hardening-wave-1/changed-files.patch`

## 20260502-232100-context7-mcp-setup

- Base commit: `1f6ac52594f74f59309c4f826a12f13744ff3553`
- Status: `completed`
- Scope:
  - global Codex MCP configuration for `Context7`
  - audit trail and rollback for the MCP change
  - follow-up repository review findings
- External files:
  - `C:\Users\rooot\.codex\config.toml`
- Verification:
  - `codex mcp add context7 --url https://mcp.context7.com/mcp`
  - `codex mcp list`
  - `codex mcp get context7`
- Session caveat:
  - active agent runtime did not hot-reload the new MCP server, so in-session developer MCP tools remained unavailable until a fresh session

## 20260502-204249-package-lint-cleanup

- Base commit: `1f6ac52594f74f59309c4f826a12f13744ff3553`
- Status: `completed`
- Scope:
  - package/lint readiness for `.vsix` generation
  - repo-wide safe cleanup of blocking ESLint error classes
  - targeted follow-up in packaging-critical runtime files
- Key follow-up files:
  - `src/auto_trigger/credential_storage.ts`
  - `src/controller/message_controller.ts`
  - `src/engine/strategies.ts`
  - `src/extension.ts`
  - `src/services/cockpitToolsAllAccounts.ts`
  - `src/shared/cloudcode_client.ts`
  - `src/storage_manager/mcp/proxyMcpServer.ts`
  - `src/storage_manager/profileManager.ts`
  - `src/storage_manager/proxy/proxyDashboardWebview.ts`
  - `src/storage_manager/quota/syncStatsWebview.ts`
  - `src/storage_manager/sync.ts`
  - `src/view/hud.ts`
- Additional safe auto-fix touched legacy files across `src/` and `src/storage_manager/` where ESLint problem/suggestion rules could be applied without changing feature scope.
- Build artifact:
  - `vscode-multi-account-cockpit-1.0.0.vsix`

## 20260502-195753-multi-account-unification

- Base commit: `1f6ac52594f74f59309c4f826a12f13744ff3553`
- Status: `completed`
- Scope:
  - account aggregation and import unification
  - storage-manager command activation
  - verification and rollback notes
- Changed source files:
  - `src/services/cockpitToolsAllAccounts.ts`
  - `src/services/cockpitToolsAllAccounts.test.ts`
  - `src/storage_manager/commandRegistration.test.ts`
  - `src/storage_manager/backup.ts`
  - `src/storage_manager/index.ts`
  - `src/view/webview/cockpit_tools.js`
