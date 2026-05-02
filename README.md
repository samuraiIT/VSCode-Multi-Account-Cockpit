# VSCode Multi-Account Cockpit

[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/samuraiIT/VSCode-Multi-Account-Cockpit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

**Unified AI IDE account manager for VS Code** — manage Antigravity, Codex, GitHub Copilot, Windsurf, Kiro, Cursor, Gemini CLI, CodeBuddy, Qoder, Trae, and Zed from a single dashboard panel.

Integrates all four projects:
1. **Cockpit Tools** – full multi-platform account management & synchronisation
2. **Antigravity Multi-Account Cockpit** – one-click account switching, quota monitoring
3. **VSCode Antigravity Cockpit** – Webview dashboard, status bar, grouping
4. **Antigravity Storage Manager** – backup/restore, export/import, multi-profile storage

---

## ✨ Features

| Feature | Description |
|---|---|
| **12-Platform Support** | Antigravity · Codex · GitHub Copilot · Windsurf · Kiro · Cursor · Gemini CLI · CodeBuddy · CodeBuddy CN · Qoder · Trae · Zed |
| **Auto-import from Cockpit Tools** | Detects and imports all accounts from a locally installed [Cockpit Tools](https://github.com/samuraiIT/cockpit-tools) installation |
| **Quota Dashboard** | Interactive WebView panel with per-model progress bars, reset timers, plan information |
| **Status Bar** | Live quota indicator in the VS Code status bar with configurable format |
| **Account CRUD** | Add, update, delete accounts; set the active account per platform |
| **Backup & Restore** | Create timestamped backups; restore from any saved backup |
| **Export / Import JSON** | Move accounts between machines or share with team members |
| **Auto-Refresh** | Configurable interval (1–60 min) for background quota polling |
| **Cross-platform** | Windows · macOS · Linux |

---

## 🚀 Quick Start

### Install

1. Install from the VS Code Extension Marketplace or open `.vsix` directly:

```bash
code --install-extension vscode-multi-account-cockpit-1.0.0.vsix
```

2. Open the dashboard with `Ctrl+Shift+P` → **Multi-Account Cockpit: Open Dashboard**

### Import from Cockpit Tools

If you already use [Cockpit Tools](https://github.com/samuraiIT/cockpit-tools), one command imports everything:

```
Ctrl+Shift+P → Multi-Account Cockpit: Import Accounts from Cockpit Tools
```

The importer auto-detects the Cockpit Tools data directory:
- **macOS**: `~/Library/Application Support/com.antigravity.cockpit-tools`
- **Windows**: `%APPDATA%\com.antigravity.cockpit-tools`
- **Linux**: `~/.config/com.antigravity.cockpit-tools`

You can also override the path in settings (`multiAccountCockpit.cockpitToolsDataDir`).

---

## 📋 Commands

| Command | Description |
|---|---|
| `Multi-Account Cockpit: Open Dashboard` | Open the interactive WebView dashboard |
| `Multi-Account Cockpit: Import Accounts from Cockpit Tools` | Auto-detect and import all Cockpit Tools accounts |
| `Multi-Account Cockpit: Refresh All Quotas` | Fetch fresh quota data for all accounts |
| `Multi-Account Cockpit: Add Account` | Add an account manually |
| `Multi-Account Cockpit: Export Accounts to JSON` | Export all accounts to a JSON file |
| `Multi-Account Cockpit: Import Accounts from JSON` | Import accounts from a previously exported JSON |
| `Multi-Account Cockpit: Backup Accounts` | Create a timestamped backup in extension storage |
| `Multi-Account Cockpit: Restore Accounts from Backup` | Pick and restore a backup |
| `Multi-Account Cockpit: Diagnose Environment` | Print diagnostics (paths, account counts) to the output channel |

---

## ⚙️ Configuration

| Setting | Default | Description |
|---|---|---|
| `multiAccountCockpit.autoRefreshInterval` | `5` | Auto-refresh interval in minutes (1–60) |
| `multiAccountCockpit.cockpitToolsDataDir` | `""` | Cockpit Tools data directory (empty = auto-detect) |
| `multiAccountCockpit.statusBarFormat` | `full` | Status bar format: `icon` · `dot` · `percent` · `dot_percent` · `name_percent` · `full` |
| `multiAccountCockpit.warningThreshold` | `30` | Quota warning threshold (%) |
| `multiAccountCockpit.criticalThreshold` | `10` | Quota critical threshold (%) |
| `multiAccountCockpit.notificationsEnabled` | `true` | Enable quota threshold notifications |
| `multiAccountCockpit.language` | `auto` | UI language |

---

## 🗂️ Data Storage

All data is stored **locally** on your machine:

| Data | Location |
|---|---|
| Accounts & settings | VS Code global storage `accounts.json` |
| Backups | `globalStorage/backups/backup-<timestamp>.json` |

Nothing is uploaded to any remote server. Network requests are made only to fetch quota data from the respective AI provider APIs using the credentials you provide.

---

## 🔒 Security

- Credentials (tokens) are stored in the VS Code global storage directory on your local filesystem.
- No third-party cloud sync — data stays on your machine.
- Backups are plain JSON; **scrub tokens before sharing** backup files.
- When importing from Cockpit Tools the extension reads their files read-only and never modifies them.

---

## 🏗️ Project Structure

```
src/
  extension.ts            — Entry point, command registration, auto-refresh loop
  types.ts                — Shared TypeScript interfaces and enums
  accountManager.ts       — CRUD, persistence, export/import, backup/restore
  cockpitToolsImporter.ts — Auto-import from Cockpit Tools data directory
  quotaService.ts         — Per-platform quota API calls
  dashboardProvider.ts    — Interactive WebView dashboard
  statusBarManager.ts     — VS Code status bar item
  processManager.ts       — IDE process launch helpers
  utils.ts                — Shared utility functions
assets/
  icon.svg                — Extension icon
```

---

## 🛠️ Build from Source

**Requirements**: Node.js ≥ 18, npm ≥ 9

```bash
git clone https://github.com/samuraiIT/VSCode-Multi-Account-Cockpit
cd VSCode-Multi-Account-Cockpit
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

---

## 🔄 Rollback Instructions

1. **Backup** before making changes:
   ```
   Ctrl+Shift+P → Multi-Account Cockpit: Backup Accounts
   ```
2. **Restore** from backup:
   ```
   Ctrl+Shift+P → Multi-Account Cockpit: Restore Accounts from Backup
   ```

---

## 📝 License

MIT

---

## 🙏 Acknowledgements

This extension integrates concepts and patterns from:
- [samuraiIT/cockpit-tools](https://github.com/samuraiIT/cockpit-tools)
- [samuraiIT/antigravity-cockpit](https://github.com/samuraiIT/antigravity-cockpit)
- [samuraiIT/vscode-antigravity-cockpit](https://github.com/samuraiIT/vscode-antigravity-cockpit)
- [samuraiIT/antigravity-storage-manager](https://github.com/samuraiIT/antigravity-storage-manager)
