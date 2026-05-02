# Task: Storage Manager Cleanup

- Version: `20260503-020600-storage-manager-cleanup`
- Date: `2026-05-03`
- Base commit: `0340ece`

## Goal

Extract a focused cleanup slice from the remaining storage-manager worktree that improves maintainability and typing without mixing in the larger proxy/style churn.

## Scope

- replace `require('os')` and `require('child_process')` hot spots with static imports
- replace ad-hoc retry marker objects in proxy MCP requests with a typed error class
- introduce a lightweight `registerTool` wrapper for MCP tool registration to avoid deep generic inference issues
- reduce fresh `any` usage in touched profile-manager error and picker paths

## Files

- `src/storage_manager/mcp/proxyMcpServer.ts`
- `src/storage_manager/profileManager.ts`

## Validation

- `npx tsc --noEmit --pretty false`
- `npx eslint src/storage_manager/mcp/proxyMcpServer.ts src/storage_manager/profileManager.ts`
