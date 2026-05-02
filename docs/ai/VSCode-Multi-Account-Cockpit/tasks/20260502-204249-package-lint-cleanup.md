# Task 20260502-204249-package-lint-cleanup

## User intent

Continue the project by making `npm run package` viable and removing the current repo-wide lint blockers that prevent `.vsix` packaging.

## Execution prompt

```text
Take VSCode-Multi-Account-Cockpit from compile/test-green to package-ready.

Requirements:
- identify the real blocking ESLint error classes and affected files
- prefer safe, mostly-automatic fixes for structural rules such as curly braces
- avoid broad architectural rewrites while reducing repo-wide lint blockers
- preserve rollbackability with dedicated backup artifacts for this cleanup pass
- verify the result with package/compile/test after changes
```

## Working assumptions

- Current `npm run package` failure is dominated by legacy lint debt, not by the newly integrated Multi-Account Cockpit functionality.
- A safe first pass is to eliminate auto-fixable error-class violations before touching warning-only style debt.

## Planned change areas

- `.eslintrc`-driven repo-wide error cleanup where safe
- targeted follow-up for non-auto-fixable ESLint errors if any remain
- backup/check/rollback docs for this cleanup pass

## Execution notes

- Ran `npx eslint src --ext ts,js --fix --fix-type problem,suggestion` to collapse the blocking error count before any manual follow-up.
- Resolved the remaining packaging blockers manually in the extension entrypoint, Cockpit Tools aggregator, storage-manager sync/proxy/MCP files, and several best-effort error-handling paths.
- Preserved file snapshots in `backups/20260502-204249-package-lint-cleanup/files-before/` before targeted edits and documentation updates.

## Results

- `npm run package` now succeeds and produces `vscode-multi-account-cockpit-1.0.0.vsix`.
- `npm run compile` and `npm test` are green after the cleanup pass.
- Full lint still emits warning-only style debt, but packaging-critical ESLint errors are eliminated.
