import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CockpitToolsImporter } from './cockpitToolsImporter';
import { AccountCredentials } from './types';

function writeJson(tempDir: string, relativePath: string, payload: unknown): void {
  const filePath = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

describe('CockpitToolsImporter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-tools-importer-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('imports shared-store account snapshots with upstream platform aliases', async () => {
    writeJson(tempDir, 'accounts.json', {
      version: '2.0',
      current_account_id: 'ag-1',
      accounts: [{ id: 'ag-1', email: 'ag@example.com', name: 'AG' }],
    });
    writeJson(tempDir, 'accounts/ag-1.json', {
      email: 'ag@example.com',
      token: {
        access_token: 'ag-access',
        refresh_token: 'ag-refresh',
      },
    });

    writeJson(tempDir, 'github_copilot_accounts.json', {
      version: '1.0',
      accounts: [{ id: 'gh-1', github_login: 'octocat', github_email: 'gh@example.com' }],
    });
    writeJson(tempDir, 'github_copilot_accounts/gh-1.json', {
      tokens: {
        access_token: 'gh-access',
        refresh_token: 'gh-refresh',
      },
    });

    writeJson(tempDir, 'gemini_accounts.json', {
      version: '1.0',
      accounts: [{ id: 'gem-1', email: 'gem@example.com', plan_name: 'pro' }],
    });
    writeJson(tempDir, 'gemini_accounts/gem-1.json', {
      auth: {
        id_token: 'gem-id',
        refresh_token: 'gem-refresh',
      },
    });

    writeJson(tempDir, 'workbuddy_accounts.json', {
      version: '1.0',
      accounts: [{ id: 'wb-1', email: 'wb@example.com', plan_type: 'pro' }],
    });
    writeJson(tempDir, 'workbuddy_accounts/wb-1.json', {
      session_token: 'wb-session',
    });

    const calls: Array<{
      platform: string;
      email: string;
      credentials: AccountCredentials;
      source: string;
      label: string | undefined;
      metadata: Record<string, unknown> | undefined;
    }> = [];

    const importer = new CockpitToolsImporter({
      getAll() {
        return [];
      },
      upsert(platform, email, credentials, source, label, metadata) {
        calls.push({ platform, email, credentials, source, label, metadata });
        return { isNew: email !== 'gh@example.com' };
      },
    });

    const result = await importer.importAll(tempDir);

    expect(result).toEqual({
      added: 3,
      updated: 1,
      errors: [],
      importedPlatforms: ['antigravity', 'copilot', 'gemini-cli', 'codebuddy-cn'],
      totalAccounts: 4,
    });

    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({
      platform: 'antigravity',
      email: 'ag@example.com',
      source: 'cockpit-tools',
      label: 'AG',
    });
    expect(calls[0]?.credentials).toMatchObject({
      accessToken: 'ag-access',
      refreshToken: 'ag-refresh',
    });

    expect(calls[1]).toMatchObject({
      platform: 'copilot',
      email: 'gh@example.com',
      label: 'octocat',
    });
    expect(calls[1]?.credentials).toMatchObject({
      accessToken: 'gh-access',
      refreshToken: 'gh-refresh',
    });

    expect(calls[2]).toMatchObject({
      platform: 'gemini-cli',
      email: 'gem@example.com',
    });
    expect(calls[2]?.credentials).toMatchObject({
      idToken: 'gem-id',
      refreshToken: 'gem-refresh',
    });

    expect(calls[3]).toMatchObject({
      platform: 'codebuddy-cn',
      email: 'wb@example.com',
    });
    expect(calls[3]?.credentials).toMatchObject({
      sessionToken: 'wb-session',
    });
  });

  it('keeps importing when an individual detail file is malformed', async () => {
    writeJson(tempDir, 'cursor_accounts.json', {
      version: '1.0',
      accounts: [{ id: 'cursor-1', email: 'cursor@example.com' }],
    });
    fs.mkdirSync(path.join(tempDir, 'cursor_accounts'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'cursor_accounts', 'cursor-1.json'), '{invalid json', 'utf8');

    const importer = new CockpitToolsImporter({
      getAll() {
        return [];
      },
      upsert() {
        return { isNew: true };
      },
    });

    const result = await importer.importAll(tempDir);

    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.totalAccounts).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('cursor-1.json');
  });

  it('reuses the existing email casing when a local account already exists', async () => {
    writeJson(tempDir, 'github_copilot_accounts.json', {
      version: '1.0',
      accounts: [{ id: 'gh-1', github_login: 'octocat', github_email: 'user@example.com' }],
    });

    const calls: string[] = [];
    const importer = new CockpitToolsImporter({
      getAll() {
        return [{
          platform: 'copilot',
          email: 'User@Example.com',
          credentials: { refreshToken: 'existing-refresh' },
        }];
      },
      upsert(_platform, email) {
        calls.push(email);
        return { isNew: false };
      },
    });

    const result = await importer.importAll(tempDir);

    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(calls).toEqual(['User@Example.com']);
  });
});
