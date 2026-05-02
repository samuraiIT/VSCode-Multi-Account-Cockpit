# VSCode Multi-Account Cockpit — Project Context

## What This Is

A unified VS Code extension that merges four existing projects into one:

| Source Project | Role |
|---|---|
| `vscode-antigravity-cockpit` | **Base foundation** — quota dashboard, HUD webview, account tree, WebSocket to Cockpit Tools |
| `cockpit-tools` | **Full sync** — Tauri desktop app, provides `~/.antigravity_cockpit/` shared data |
| `antigravity-cockpit` | **OAuth & multi-account backend** — account switching, credential storage |
| `antigravity-storage-manager` | **Storage features** — Google Drive sync, backup, profiles, Telegram, MCP, proxy |

## Architecture

```
VSCode-Multi-Account-Cockpit/
├── src/
│   ├── extension.ts              ← Main entry; activates cockpit + storage manager
│   ├── controller/               ← Status bar, commands, messages, telemetry
│   ├── engine/                   ← Process hunter + reactor core (quota polling)
│   ├── services/
│   │   ├── cockpitToolsAllAccounts.ts  ← Reads ~/.antigravity_cockpit/ for all providers
│   │   ├── importService.ts           ← Codex account import
│   │   ├── cockpitToolsWs.ts          ← WebSocket to Cockpit Tools desktop
│   │   └── ...
│   ├── storage_manager/          ← Ported from antigravity-storage-manager
│   │   ├── index.ts              ← Integration entry; registers multiCockpit.* commands
│   │   ├── backup.ts             ← Conversation backup/restore
│   │   ├── sync.ts               ← Google Drive sync
│   │   ├── googleAuth.ts         ← Google OAuth2
│   │   ├── profileManager.ts     ← Account profile management
│   │   ├── conflicts.ts          ← Sync conflict resolution
│   │   ├── markdownExporter.ts   ← Markdown export
│   │   ├── telegram/             ← Telegram bot notifications
│   │   ├── quota/                ← Quota monitoring (antigravityClient, pbParser)
│   │   ├── mcp/                  ← MCP proxy server
│   │   ├── proxy/                ← nginx-based proxy
│   │   └── diagnostics/          ← Health diagnostics
│   ├── view/
│   │   ├── hud.ts                ← Main webview panel
│   │   └── webview/
│   │       ├── cockpit_tools.js  ← "Cockpit Tools" tab (unified provider accounts)
│   │       └── ...
│   └── shared/                   ← Types, i18n, config, logging
├── l10n/                         ← Localization bundles (17 languages)
└── out/                          ← Build output (esbuild)
```

## Command Namespaces

- `agCockpit.*` — Core cockpit commands (quota, accounts, sync with Cockpit Tools)
- `multiCockpit.*` — Storage manager features (backup, Google Drive, profiles, Telegram)

## Key Keybindings

| Shortcut | Command |
|---|---|
| Ctrl+Shift+Q | Open Cockpit Dashboard |
| Ctrl+Shift+R | Refresh Quota |
| Ctrl+Alt+B | Backup Conversations |
| Ctrl+Alt+S | Sync Now (Google Drive) |
| Ctrl+Alt+E | Export as Markdown |
| Ctrl+Alt+P | Switch Profile |

## Shared Data Dir

`~/.antigravity_cockpit/` — Written by Cockpit Tools desktop app, read by this extension.

Providers detected:
- `accounts.json` → Antigravity AI
- `codex_accounts.json` → OpenAI Codex
- `cursor_accounts.json` → Cursor
- `github_copilot_accounts.json` → GitHub Copilot

## Storage Root

Google Drive sync / backup / profiles operate on `~/.gemini/antigravity/` (inherited from antigravity-storage-manager).

## Build

```bash
npm install
npm run build          # development
npm run build:prod     # production (for packaging)
npm run package        # produce .vsix
```

## Version

v1.0.0 — Initial unified release (2026-05-02)
