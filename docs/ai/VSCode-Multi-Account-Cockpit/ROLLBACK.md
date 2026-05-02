# Rollback Guide

## Current active version

- `20260502-195753-multi-account-unification`
- `20260503-000812-security-hardening-wave-1`

## Pre-change snapshot

- Working tree patch:
  - `docs/ai/VSCode-Multi-Account-Cockpit/backups/20260502-195753-multi-account-unification/pre-change-working-tree.patch`
- Working tree patch:
  - `docs/ai/VSCode-Multi-Account-Cockpit/backups/20260503-000812-security-hardening-wave-1/pre-change-working-tree.patch`

## Rollback plan

1. Inspect current diff with `git status --short` and `git diff`.
2. Review task notes in `docs/ai/VSCode-Multi-Account-Cockpit/tasks/20260502-195753-multi-account-unification.md`.
3. Revert only files changed by this task, using the final `changed-files.patch` artifact from the task backup folder.
4. If needed, re-apply the pre-change patch for unrelated local state captured before this task started.
5. For the security hardening wave, revert only the wave-1 changed files using the backup folder artifacts instead of resetting the repository.

## Safety note

- Do not overwrite user changes outside the task scope, especially `.vscode/settings.json`.
