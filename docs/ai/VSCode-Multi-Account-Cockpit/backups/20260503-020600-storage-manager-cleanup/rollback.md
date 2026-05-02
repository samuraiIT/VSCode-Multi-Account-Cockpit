# Rollback

1. Revert the commit that introduces `20260503-020600-storage-manager-cleanup`.
2. Re-run:
   - `npx tsc --noEmit --pretty false`
   - `npx eslint src/storage_manager/mcp/proxyMcpServer.ts src/storage_manager/profileManager.ts`

## Files

- `src/storage_manager/mcp/proxyMcpServer.ts`
- `src/storage_manager/profileManager.ts`
