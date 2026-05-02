# Backup Manifest

- Version: `20260503-015100-backup-config-alignment`
- Base commit: `d10f7ff`
- Scope:
  - align backup scheduling and retention logic with `multiCockpit.backup.*` settings
  - preserve compatibility with legacy backup path and interval storage
  - add regression tests for backup target resolution and retention cleanup
- Captured artifacts:
  - `changed-files.patch`
  - `rollback.md`
