# Task: Proxy Network Cleanup

- Version: `20260503-022400-proxy-network-cleanup`
- Date: `2026-05-03`
- Base commit: `5f60998`

## Goal

Extract a narrow, low-risk cleanup slice from `proxyManager.ts` that improves maintainability in the network/download path without dragging in the file's broader style churn.

## Scope

- replace the last dynamic `require('http')` usage with a static import
- keep `fetchJson` runtime-compatible while cleaning up request parsing
- centralize partial-download cleanup for redirect/error/cancel branches
- switch touched proxy-manager error handling to `unknown` + message extraction

## Files

- `src/storage_manager/proxy/proxyManager.ts`

## Validation

- `npx tsc --noEmit --pretty false`
- `npx eslint src/storage_manager/proxy/proxyManager.ts`
