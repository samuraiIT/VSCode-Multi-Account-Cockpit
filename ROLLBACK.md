# Rollback Instructions

## Rollback to vscode-antigravity-cockpit (base)

If you need to revert to the original base extension without the multi-account additions:

```bash
# The original base is still intact:
cd "c:/Диск D/!project_Windows/projects/vscode-antigravity-cockpit"
git log --oneline -5
```

The last commit there includes the Cockpit Tools tab integration (`bcd26f9`).

## Rollback multiCockpit.* storage manager features

Remove the storage manager integration without losing the cockpit base:

1. In `src/extension.ts`, remove these two lines:
   ```typescript
   import { activateStorageManager } from './storage_manager/index';
   void activateStorageManager(context);
   ```

2. Optionally delete `src/storage_manager/` directory.

3. In `package.json`, remove the `multiCockpit.*` commands and configuration entries.

4. Remove new dependencies from `package.json`:
   - `@modelcontextprotocol/sdk`
   - `archiver`, `extract-zip`
   - `googleapis`
   - `markdown-it`, `node-cron`
   - `protobufjs`, `zod`

5. Re-run `npm install && npm run build`.

## Rollback Cockpit Tools auto-import integration

This workspace now has a pre-change backup at:

`docs/backups/2026-05-03-cockpit-auto-import/`

To roll back only this integration:

1. Restore these files from the backup copy:
   - `src/services/cockpitToolsAllAccounts.ts`
   - `src/view/webview/cockpit_tools.js`
   - `src/view/hud.ts`
   - `src/controller/message_controller.ts`
   - `src/shared/types.ts`
   - `src/extension.ts`
   - `package.json`
   - `README.md`
2. Run `npm install` (if package metadata changed).
3. Run `npm run build`.

## Rollback package.json identity

Revert `name`, `displayName`, `description`, `version` back to:
```json
{
  "name": "antigravity-cockpit",
  "displayName": "Antigravity Cockpit",
  "description": "A premium, dashboard-style quota monitor for Antigravity AI.",
  "version": "2.1.52"
}
```

## Source References

All source projects remain untouched at:

| Project | Path |
|---|---|
| vscode-antigravity-cockpit | `c:/Диск D/!project_Windows/projects/vscode-antigravity-cockpit` |
| antigravity-storage-manager | `c:/Диск D/!project_Windows/projects/antigravity-storage-manager` |
| cockpit-tools | `c:/Диск D/!project_Windows/projects/cockpit-tools` |
| antigravity-cockpit | `c:/Диск D/!project_Windows/projects/antigravity-cockpit` |
