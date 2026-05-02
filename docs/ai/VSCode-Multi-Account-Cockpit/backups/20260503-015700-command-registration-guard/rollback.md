# Rollback

1. Revert the commit that introduces `20260503-015700-command-registration-guard`.
2. Re-run:
   - `npx jest src/storage_manager/commandRegistration.test.ts --runInBand`
   - `npx eslint src/storage_manager/commandRegistration.test.ts`

## Files

- `src/storage_manager/commandRegistration.test.ts`
