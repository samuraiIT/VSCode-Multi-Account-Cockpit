# Task: Command Registration Guard

- Version: `20260503-015700-command-registration-guard`
- Date: `2026-05-03`
- Base commit: `00a7565`

## Goal

Commit the missing regression guard that checks runtime registration coverage for the public `multiCockpit.*` command surface.

## Scope

- track `src/storage_manager/commandRegistration.test.ts`
- remove the remaining lint warning in the test
- preserve a small, isolated validation slice with no runtime behavior changes

## Files

- `src/storage_manager/commandRegistration.test.ts`

## Validation

- `npx jest src/storage_manager/commandRegistration.test.ts --runInBand`
- `npx eslint src/storage_manager/commandRegistration.test.ts`
