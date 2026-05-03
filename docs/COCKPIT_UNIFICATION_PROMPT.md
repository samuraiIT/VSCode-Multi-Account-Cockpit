# VSCode-Multi-Account Cockpit — Integration Prompt

Use this execution prompt to keep the project aligned with the unified architecture:

```text
Goal: build one unified VS Code extension “VSCode-Multi-Account Cockpit” by consolidating:
1) cockpit-tools (full account index sync),
2) antigravity-cockpit foundation,
3) vscode-antigravity-cockpit foundation,
4) antigravity-storage-manager features.

Required behavior:
- Read all Cockpit Tools account index files from ~/.antigravity_cockpit.
- Show all providers in one Cockpit Tools tab.
- Auto-import account snapshot on startup.
- Sync Antigravity refresh-token accounts from Cockpit Tools into extension auth storage.
- Keep backward-compatible message protocol for existing webview messages.
- Add rollback safety: create backups before edits and document rollback steps.

Implementation rules:
- Reuse existing services/controllers where possible.
- Preserve non-breaking behavior for current commands.
- Add/adjust commands for auto-import without removing existing manual import path.
- Update README + rollback docs after code changes.
- Run lint/build/test and fix regressions.
```
