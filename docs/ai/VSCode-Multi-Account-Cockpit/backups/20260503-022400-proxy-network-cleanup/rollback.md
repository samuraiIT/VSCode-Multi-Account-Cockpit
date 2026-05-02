# Rollback

1. Revert the commit that introduces `20260503-022400-proxy-network-cleanup`.
2. Re-run:
   - `npx tsc --noEmit --pretty false`
   - `npx eslint src/storage_manager/proxy/proxyManager.ts`

## Files

- `src/storage_manager/proxy/proxyManager.ts`
