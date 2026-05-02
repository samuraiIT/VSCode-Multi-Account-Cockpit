## Project

- Name: `VSCode-Multi-Account-Cockpit`
- Type: VS Code extension
- Goal: unify quota cockpit, Cockpit Tools account overview/sync, and storage-manager operations into one extension.
- Primary upstreams:
  - `cockpit-tools`
  - `antigravity-cockpit`
  - `vscode-antigravity-cockpit`
  - `antigravity-storage-manager`

## Current task

- Task id: `20260502-195753-multi-account-unification`
- Focus:
  - complete Cockpit Tools account coverage and automatic account import/sync flows
  - close runtime gaps between declared commands and registered storage-manager commands
  - keep changes minimal, testable, and rollback-friendly

## Constraints

- Do not revert unrelated user changes.
- Record backups before edits.
- Prefer integration over rewrite.
- Preserve current extension architecture unless a gap forces a local refactor.

## Observed baseline

- Git HEAD: `1f6ac52594f74f59309c4f826a12f13744ff3553`
- Pre-change dirty file detected: `.vscode/settings.json`
- Pre-change patch stored under:
  - `docs/ai/VSCode-Multi-Account-Cockpit/backups/20260502-195753-multi-account-unification/pre-change-working-tree.patch`
