# Rollback

1. Revert the commit that introduces `20260503-014616-cockpit-tools-provider-expansion`.
2. Re-run:
   - `npx jest src/services/cockpitToolsAllAccounts.test.ts --runInBand`
   - `npx eslint src/services/cockpitToolsAllAccounts.ts src/services/cockpitToolsAllAccounts.test.ts`

## Files

- `src/services/cockpitToolsAllAccounts.ts`
- `src/services/cockpitToolsAllAccounts.test.ts`
