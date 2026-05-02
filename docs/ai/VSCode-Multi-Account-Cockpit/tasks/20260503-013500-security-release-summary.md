# Security Release Summary — 2026-05-03

- Scope:
  - validated finding remediation
  - deferred shard closure
  - TypeScript input-scope cleanup for trustworthy verification

- Fixed controls:
  - Google OAuth callback now verifies `state` and binds to loopback only
  - privileged webview command bridge now enforces command and URL policy
  - sync stats markdown no longer accepts raw HTML from stored content
  - imported account IDs are validated before filesystem writes
  - local sync storage operations are constrained to the configured storage root
  - Telegram inbound auth no longer trusts username-only first contact
  - Google Drive sync names and query literals are validated/escaped before Drive API lookup
  - Cloud Code URL overrides are allowlisted before bearer-token requests
  - local conversation file open paths are resolved inside expected roots only

- Verification highlights:
  - focused ESLint runs completed with warnings only
  - `tsc --noEmit` no longer compiles `docs/ai/**`; remaining failures are real pre-existing source/dependency issues
  - rollback artifacts captured in the version backup folder

- Commit grouping:
  - security hardening code
  - build/verification scope cleanup
  - docs/audit trail finalization
