# Rollback

1. Revert the commit that introduces `20260503-015100-backup-config-alignment`.
2. Re-run:
   - `npx jest src/storage_manager/backup.test.ts --runInBand`
   - `npx eslint src/storage_manager/backup.ts src/storage_manager/backup.test.ts`

## Files

- `src/storage_manager/backup.ts`
- `src/storage_manager/backup.test.ts`
