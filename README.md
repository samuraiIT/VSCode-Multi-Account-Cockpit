# Multi-Account Cockpit

[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/samuraiIT/VSCode-Multi-Account-Cockpit)
[![License](https://img.shields.io/github/license/samuraiIT/VSCode-Multi-Account-Cockpit)](LICENSE)

A unified VS Code extension that combines quota monitoring, multi-account management, Google Drive sync, backup/restore, Telegram notifications, and MCP server support for all major AI providers.

**Supported Providers**: Antigravity AI · OpenAI Codex · Cursor · GitHub Copilot

---

## Features

### Cockpit Dashboard

Full webview dashboard with quota monitoring for Antigravity AI:

- **Card / List Views** with drag-and-drop sorting
- **Quota Grouping** — models sharing the same quota pool are grouped automatically
- **Status Bar Monitor** — 6 display formats, pinnable models/groups
- **Threshold Notifications** — warning and critical quota alerts
- **Privacy Mode** — mask sensitive data (email, etc.)

### Cockpit Tools Tab

Unified view of **all accounts** across all providers read from `~/.antigravity_cockpit/`:

| Provider | Source File |
|---|---|
| Antigravity AI | `accounts.json` |
| OpenAI Codex | `codex_accounts.json` |
| Cursor | `cursor_accounts.json` |
| GitHub Copilot | `github_copilot_accounts.json` |

Search by email, filter by provider, see plan badges and active account status.

### Auto Wake-up (Auto Trigger)

Schedule automated requests to wake up AI models and trigger quota reset cycles:

- **Flexible Scheduling**: Daily, weekly, interval, and Crontab modes
- **Multi-Account**: Authorize multiple accounts and switch between them
- **Secure**: Credentials encrypted in VS Code Secret Storage

### Backup & Restore

- **Manual or scheduled backups** of Antigravity conversations (`~/.gemini/antigravity/`)
- **Restore** from any previous backup
- Configurable retention period

### Google Drive Sync

- **OAuth2 authentication** — link your Google account
- **Auto-sync** on a configurable schedule
- **Conflict resolution** — handles multi-machine sync conflicts
- **Encryption** — conversations encrypted before upload

### Profile Management

Save and switch between named account profiles. Each profile stores the active account state so you can quickly switch contexts.

### Markdown Export

Export any conversation(s) from local storage to Markdown files.

### Telegram Bot Notifications

Receive quota status and sync reports via a Telegram bot.

### MCP Proxy Server

Built-in MCP (Model Context Protocol) proxy server for tool integration.

### Diagnostics

One-click diagnostics report: internet connectivity, quota system health, sync latency.

---

## Quick Start

1. Install the extension
2. Open the Cockpit dashboard: `Ctrl+Shift+Q` (or `Cmd+Shift+Q` on Mac)
3. The status bar shows your current Antigravity quota
4. Switch to the **Cockpit Tools** tab to see all provider accounts

---

## Keybindings

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Q` | Open Cockpit Dashboard |
| `Ctrl+Shift+R` | Refresh Quota (when dashboard is active) |
| `Ctrl+Alt+B` | Backup Conversations |
| `Ctrl+Alt+S` | Sync Now (Google Drive) |
| `Ctrl+Alt+E` | Export as Markdown |
| `Ctrl+Alt+P` | Switch Account Profile |

---

## Commands

### Antigravity Cockpit (`agCockpit.*`)

| Command | Description |
|---|---|
| `agCockpit.open` | Open Cockpit Dashboard |
| `agCockpit.refresh` | Refresh quota data |
| `agCockpit.importCockpitAccounts` | Import accounts from Cockpit Tools export |
| `agCockpit.syncFromCockpitTools` | Sync Antigravity accounts from Cockpit Tools |

### Multi-Account Cockpit (`multiCockpit.*`)

| Command | Description |
|---|---|
| `multiCockpit.backup` | Backup all conversations |
| `multiCockpit.exportMarkdown` | Export conversations as Markdown |
| `multiCockpit.syncSetup` | Setup Google Drive sync |
| `multiCockpit.syncNow` | Sync now |
| `multiCockpit.switchProfile` | Switch account profile |
| `multiCockpit.saveProfile` | Save current profile |
| `multiCockpit.deleteProfile` | Delete a profile |
| `multiCockpit.resolveConflicts` | Resolve sync conflicts |
| `multiCockpit.showDiagnostics` | Show diagnostics report |
| `multiCockpit.telegramSetup` | Setup Telegram bot notifications |

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `agCockpit.displayMode` | `webview` | Display mode: `webview` / `quickpick` |
| `agCockpit.refreshInterval` | `120` | Refresh interval (seconds, 10–3600) |
| `agCockpit.statusBarFormat` | `standard` | Status bar format |
| `agCockpit.groupingEnabled` | `true` | Enable quota grouping |
| `agCockpit.warningThreshold` | `30` | Warning threshold (%) |
| `agCockpit.criticalThreshold` | `10` | Critical threshold (%) |
| `agCockpit.notificationEnabled` | `true` | Enable notifications |
| `agCockpit.quotaSource` | `authorized` | Quota source: `local` / `authorized` |
| `multiCockpit.backup.autoBackup` | `true` | Auto-backup on schedule |
| `multiCockpit.backup.retentionDays` | `30` | Backup retention (days) |
| `multiCockpit.sync.enabled` | `false` | Enable Google Drive sync |
| `multiCockpit.telegram.enabled` | `false` | Enable Telegram notifications |
| `multiCockpit.mcp.enabled` | `false` | Enable MCP proxy server |
| `multiCockpit.mcp.port` | `3100` | MCP server port |

---

## Build from Source

```bash
git clone https://github.com/samuraiIT/VSCode-Multi-Account-Cockpit.git
cd VSCode-Multi-Account-Cockpit
npm install
npm run build       # development
npm run build:prod  # production
npm run package     # produce .vsix
```

Requirements: Node.js v18+, npm v9+

---

## Project Structure

```
src/
├── extension.ts              ← Main entry point
├── controller/               ← Status bar, commands, messages
├── engine/                   ← Process hunter + quota reactor
├── services/
│   ├── cockpitToolsAllAccounts.ts  ← Reads ~/.antigravity_cockpit/
│   ├── cockpitToolsWs.ts           ← WebSocket to Cockpit Tools
│   └── importService.ts            ← Account import
├── storage_manager/          ← Ported from antigravity-storage-manager
│   ├── backup.ts, sync.ts, profileManager.ts, ...
│   └── index.ts              ← Integration entry point
├── view/
│   ├── hud.ts                ← Main webview panel
│   └── webview/cockpit_tools.js ← Cockpit Tools tab
└── shared/                   ← Types, i18n, config, logging
```

---

## Source Projects

This extension merges four projects:

| Project | Contribution |
|---|---|
| [vscode-antigravity-cockpit](https://github.com/jlcodes99/vscode-antigravity-cockpit) | Base foundation: quota dashboard, HUD, WebSocket |
| [cockpit-tools](https://github.com/samuraiIT/cockpit-tools) | Shared data dir (`~/.antigravity_cockpit/`) |
| antigravity-cockpit | OAuth & multi-account backend |
| [antigravity-storage-manager](https://github.com/unchase/antigravity-storage-manager) | Backup, sync, profiles, Telegram, MCP |

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## Rollback

See [ROLLBACK.md](ROLLBACK.md) for instructions to revert individual features.

---

## License

[MIT](LICENSE)

---

## Disclaimer

This project is for personal learning and research purposes only. Not affiliated with or endorsed by Antigravity AI, OpenAI, Cursor, or GitHub. Use at your own risk and in compliance with each service's terms of service.
