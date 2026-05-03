import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AccountManager } from './accountManager';

function makeContext(storageDir: string) {
  return {
    globalStorageUri: { fsPath: storageDir },
  } as unknown as import('vscode').ExtensionContext;
}

describe('AccountManager', () => {
  let tempDir: string;
  let manager: AccountManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-manager-test-'));
    manager = new AccountManager(makeContext(tempDir));
  });

  afterEach(() => {
    manager.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('upsert', () => {
    it('creates a new account on first call', () => {
      const { account, isNew } = manager.upsert('copilot', 'user@example.com', {
        accessToken: 'tok1',
      }, 'cockpit-tools', 'User');

      expect(isNew).toBe(true);
      expect(account.platform).toBe('copilot');
      expect(account.email).toBe('user@example.com');
      expect(account.credentials.accessToken).toBe('tok1');
    });

    it('updates instead of creating a duplicate when email casing differs', () => {
      manager.upsert('copilot', 'User@Example.com', { accessToken: 'tok1' }, 'cockpit-tools');
      const { account, isNew } = manager.upsert('copilot', 'user@example.com', {
        accessToken: 'tok2',
      }, 'cockpit-tools');

      expect(isNew).toBe(false);
      expect(manager.getAll()).toHaveLength(1);
      expect(account.credentials.accessToken).toBe('tok2');
    });

    it('preserves the original email casing on update', () => {
      manager.upsert('copilot', 'User@Example.com', { accessToken: 'tok1' }, 'cockpit-tools');
      const { account } = manager.upsert('copilot', 'user@example.com', {
        accessToken: 'tok2',
      }, 'cockpit-tools');

      // The stored email should still use the original casing from the first insert
      expect(account.email).toBe('User@Example.com');
    });

    it('does not confuse accounts on different platforms with the same email', () => {
      manager.upsert('copilot', 'user@example.com', { accessToken: 'tok1' }, 'cockpit-tools');
      const { isNew } = manager.upsert('gemini-cli', 'user@example.com', { accessToken: 'tok2' }, 'cockpit-tools');

      expect(isNew).toBe(true);
      expect(manager.getAll()).toHaveLength(2);
    });
  });
});
