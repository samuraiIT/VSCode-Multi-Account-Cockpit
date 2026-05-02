import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Account, Platform } from './types';

interface ProcessInfo {
  pid?: number;
  platform: Platform;
  executablePath: string;
}

/**
 * Manages starting and stopping IDE processes for a given account.
 * Currently supports Antigravity and is designed to be extended.
 */
export class ProcessManager implements vscode.Disposable {
  private readonly procs: Map<string, ProcessInfo> = new Map();

  // ── Public API ──────────────────────────────────────────────────────────────

  async launchForAccount(account: Account): Promise<void> {
    const execPath = this.resolveExecutable(account.platform);
    if (!execPath) {
      vscode.window.showWarningMessage(
        `Cannot find executable for ${account.platform}. Set the path in settings.`
      );
      return;
    }

    const terminal = vscode.window.createTerminal({
      name: `${account.platform}: ${account.label}`,
      shellPath: execPath,
      hideFromUser: false,
    });
    terminal.show();
  }

  /**
   * Return the resolved executable path for a platform, using:
   * 1. VS Code settings override
   * 2. Well-known platform default paths
   */
  resolveExecutable(platform: Platform): string | null {
    const cfg = vscode.workspace.getConfiguration('multiAccountCockpit');
    const cfgKey = `${platform}ExecutablePath`;
    const override = cfg.get<string>(cfgKey, '');
    if (override && fs.existsSync(override)) return override;

    const defaults = this.defaultPaths(platform);
    for (const p of defaults) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private defaultPaths(platform: Platform): string[] {
    const home = os.homedir();
    switch (platform) {
      case 'antigravity':
        if (process.platform === 'win32') {
          return [
            path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Antigravity', 'Antigravity.exe'),
          ];
        } else if (process.platform === 'darwin') {
          return ['/Applications/Antigravity.app/Contents/MacOS/Antigravity'];
        } else {
          return ['/usr/bin/antigravity', path.join(home, '.local', 'bin', 'antigravity')];
        }
      case 'cursor':
        if (process.platform === 'win32') {
          return [path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'cursor', 'Cursor.exe')];
        } else if (process.platform === 'darwin') {
          return ['/Applications/Cursor.app/Contents/MacOS/Cursor'];
        } else {
          return ['/usr/bin/cursor'];
        }
      case 'windsurf':
        if (process.platform === 'win32') {
          return [path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'windsurf', 'Windsurf.exe')];
        } else if (process.platform === 'darwin') {
          return ['/Applications/Windsurf.app/Contents/MacOS/Windsurf'];
        } else {
          return ['/usr/bin/windsurf'];
        }
      default:
        return [];
    }
  }

  dispose(): void {
    this.procs.clear();
  }
}
