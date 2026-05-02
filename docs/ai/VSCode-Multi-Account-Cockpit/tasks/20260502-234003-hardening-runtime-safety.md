# Task 20260502-234003-hardening-runtime-safety

## User intent

Continue with runtime hardening in this order:
1. protect secrets in terminal-based MCP startup
2. remove destructive import overwrite behavior
3. fix MCP autostart config drift and backup retention cleanup scope
4. create stepwise commits

## Planned stages

- stage 1: secret-safe MCP startup path
- stage 2: safe conversation import overwrite flow
- stage 3: MCP autostart bridge + backup retention scope hardening
- stage 4: verification, docs, rollback artifacts, final commit
