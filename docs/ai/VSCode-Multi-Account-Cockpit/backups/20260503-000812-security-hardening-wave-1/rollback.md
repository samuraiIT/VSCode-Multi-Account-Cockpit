# Rollback Notes

1. Review `git diff -- src/controller/message_controller.ts src/storage_manager/googleAuth.ts src/storage_manager/quota/syncStatsWebview.ts src/storage_manager/sync.ts`.
2. Compare current file state with `pre-change-working-tree.patch`.
3. Revert only the wave-1 edits after the final `changed-files.patch` is generated.
4. Do not discard unrelated local changes elsewhere in the repository.
