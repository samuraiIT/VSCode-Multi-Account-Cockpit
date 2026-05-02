# AI Change Log

## 20260503-014616-cockpit-tools-provider-expansion

- Split the Cockpit Tools account reader expansion out of the broader dirty worktree into its own reviewable slice.
- Replaced the hard-coded 4-provider readers with provider definitions that cover the current Cockpit Tools export set.
- Added shared current-account resolution through `provider_current_accounts.json` for providers that do not persist `current_account_id` inline.
- Preserved graceful degradation so malformed provider files are logged and skipped instead of breaking the whole snapshot.
- Added targeted regression tests for multi-provider loading and malformed JSON tolerance.

## 20260503-000812-security-hardening-wave-1

- Started a focused security remediation wave for the highest-impact validated findings from the repository scan.
- Reserved an isolated backup/rollback scope for targeted fixes in OAuth, announcement action handling, and sync-stats rendering.
- Added OAuth callback `state` validation and loopback-only listener binding for Google Drive sign-in.
- Restricted webview-triggered command execution to an allowlist and blocked unsafe external URL schemes in the privileged message bridge.
- Disabled raw HTML rendering in sync stats markdown paths to remove stored XSS sinks from search results and conversation previews.
- Rejected unsafe imported account IDs, added local-storage path guards, and removed username-only Telegram inbound authorization.
- Closed the deferred shard by hardening Google Drive filename/query handling, Cloud Code base URL overrides, and local conversation path resolution.
- Reduced TypeScript verification noise by scoping `tsconfig.json` to `src/**/*.ts`, which cleanly separates real source type errors from `docs/ai` backup snapshots.

## 20260502-232100-context7-mcp-setup

- Added global `Context7` MCP configuration for Codex using the project-wide MCP canon from `docs/mcp/MCP_RemoteSSH_Ubuntu_Auto_Setup.md`.
- Backed up the previous `C:\Users\rooot\.codex\config.toml` before the change and prepared rollback instructions.
- Verified the new server via `codex mcp list` / `codex mcp get context7`.
- Recorded a follow-up full-code audit with concrete runtime/security findings for storage-manager, proxy/MCP startup, and import flows.

## 20260502-204249-package-lint-cleanup

- Created a dedicated backup/rollback scope for the packaging cleanup pass and preserved source/doc snapshots before manual follow-up edits.
- Ran a safe repo-wide ESLint auto-fix pass for blocking error-class rules to cut down packaging failures without broad architectural rewrites.
- Replaced the remaining blocking patterns manually:
  - empty `catch` blocks in best-effort flows
  - `require(...)` hot spots for `fs`, `child_process`, `os`, and `markdown-it`
  - literal retry throws in the proxy MCP server
  - `while (true)` loops that violated `no-constant-condition`
- Kept the `cockpit-tools` multi-account integration intact while hardening the new aggregator helper with strict null checks.
- Restored successful `.vsix` packaging and removed temporary ESLint report artifacts after verification.

## 20260502-195753-multi-account-unification

- Created backup and rollback scaffold before code changes.
- Expanded Cockpit Tools account aggregation from 4 providers to the full current `cockpit-tools` account index set, including shared current-account state resolution.
- Restored missing storage-manager runtime pieces:
  - `multiCockpit.restore`
  - `multiCockpit.importConversations`
  - `multiCockpit.startMcpServer`
  - `multiCockpit.stopMcpServer`
- Added compatibility bridge between new `multiCockpit.*` settings/commands and imported upstream `antigravity-storage-manager` internals.
- Initialized proxy/MCP manager path inside the unified extension and added legacy command aliases required by upstream webviews/status items.
- Fixed backup flow to support explicit `.zip` targets and retention-by-days behavior from the current package settings.
- Updated Cockpit Tools webview provider styling for the newly surfaced providers.
- Added regression tests for multi-provider Cockpit Tools account aggregation and malformed-index tolerance.
- Added automated command-registration guard to ensure all public `multiCockpit.*` commands declared in `package.json` remain registered in runtime.
