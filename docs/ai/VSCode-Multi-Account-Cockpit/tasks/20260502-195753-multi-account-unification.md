# Task 20260502-195753-multi-account-unification

## User intent

Continue the project and unify the extension around four upstream codebases, with backups, rollback instructions, self-checks, and multi-agent execution.

## Execution prompt

```text
Build VSCode-Multi-Account-Cockpit as a single unified VS Code extension that combines:
1. cockpit-tools synchronization and account data compatibility
2. antigravity-cockpit foundation
3. vscode-antigravity-cockpit UX and quota cockpit
4. antigravity-storage-manager operational features

Requirements:
- automatically import and surface all Cockpit Tools accounts that are relevant to the extension
- close mismatches between declared package commands and runtime command registration
- preserve existing working features and avoid broad rewrites
- create backups before edits
- document version, scope, rollback, and checks
- verify compilation/build behavior after changes
```

## Working assumptions

- Full parity with all upstream desktop-only features is not realistic inside a VS Code extension in one pass.
- Highest-value integration is:
  - account visibility and sync alignment
  - operational command activation
  - keeping the current extension stable

## Files expected to change

- `src/services/cockpitToolsAllAccounts.ts`
- `src/services/cockpitToolsAllAccounts.test.ts`
- `src/storage_manager/backup.ts`
- `src/storage_manager/commandRegistration.test.ts`
- `src/storage_manager/index.ts`
- `src/view/webview/cockpit_tools.js`
- verification/docs files as needed

## Result

- Completed the unified account reader for all current Cockpit Tools provider index files.
- Reconnected the storage-manager operational layer inside the extension runtime, including proxy/MCP bootstrap and missing command registrations.
- Added regression coverage for both multi-provider account aggregation and public command registration parity.
- Preserved rollback artifacts and documented verification results.
