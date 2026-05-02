# Task: Backup Config Alignment

- Version: `20260503-015100-backup-config-alignment`
- Date: `2026-05-03`
- Base commit: `d10f7ff`

## Goal

Extract the backup manager behavior changes into a standalone, verifiable slice so the runtime/config contract is reviewable independently from the rest of the dirty worktree.

## Scope

- read backup enablement and retention from the public `multiCockpit.backup.*` namespace
- keep compatibility for legacy backup path and interval values still used by imported upstream modules
- support explicit `.zip` destinations in `backupNow`
- apply retention cleanup only to scheduled/default-directory backups
- add regression coverage for target resolution and retention-by-days deletion

## Files

- `src/storage_manager/backup.ts`
- `src/storage_manager/backup.test.ts`

## Validation

- `npx jest src/storage_manager/backup.test.ts --runInBand`
- `npx eslint src/storage_manager/backup.ts src/storage_manager/backup.test.ts`
