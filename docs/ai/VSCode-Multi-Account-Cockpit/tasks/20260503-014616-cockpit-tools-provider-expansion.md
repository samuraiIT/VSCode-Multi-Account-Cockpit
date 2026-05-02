# Task: Cockpit Tools Provider Expansion

- Version: `20260503-014616-cockpit-tools-provider-expansion`
- Date: `2026-05-03`
- Base commit: `7dfbf69`

## Goal

Isolate and validate the Cockpit Tools account-aggregation expansion as a standalone change slice instead of leaving it buried inside the wider dirty worktree.

## Scope

- generalize the account reader from a fixed provider list to provider definitions
- support additional Cockpit Tools account index files
- resolve current-account state from `provider_current_accounts.json` for providers that use shared state
- preserve malformed-file tolerance so one bad provider file does not break the snapshot
- add regression coverage for the expanded reader behavior

## Files

- `src/services/cockpitToolsAllAccounts.ts`
- `src/services/cockpitToolsAllAccounts.test.ts`

## Validation

- `npx jest src/services/cockpitToolsAllAccounts.test.ts --runInBand`
- `npx eslint src/services/cockpitToolsAllAccounts.ts src/services/cockpitToolsAllAccounts.test.ts`
