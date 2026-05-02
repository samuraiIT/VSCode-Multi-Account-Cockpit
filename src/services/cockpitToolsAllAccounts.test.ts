import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let mockedSharedDir = '';

jest.mock('../shared/antigravity_paths', () => ({
    getCockpitToolsSharedDir: () => mockedSharedDir,
}));

const loggerWarn = jest.fn();
const loggerDebug = jest.fn();

jest.mock('../shared/log_service', () => ({
    logger: {
        warn: (...args: unknown[]) => loggerWarn(...args),
        debug: (...args: unknown[]) => loggerDebug(...args),
    },
}));

import { readAllCockpitAccounts } from './cockpitToolsAllAccounts';

function writeJson(fileName: string, payload: unknown) {
    fs.writeFileSync(path.join(mockedSharedDir, fileName), JSON.stringify(payload, null, 2), 'utf8');
}

describe('cockpitToolsAllAccounts', () => {
    beforeEach(() => {
        mockedSharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-tools-accounts-'));
        loggerWarn.mockClear();
        loggerDebug.mockClear();
    });

    afterEach(() => {
        fs.rmSync(mockedSharedDir, { recursive: true, force: true });
        mockedSharedDir = '';
    });

    it('reads all configured providers and resolves current accounts from shared state', () => {
        writeJson('accounts.json', {
            version: '1.0',
            current_account_id: 'ag-1',
            accounts: [
                { id: 'ag-1', email: 'ag@example.com', name: 'Antigravity One', created_at: 10, last_used: 20 },
            ],
        });

        writeJson('cursor_accounts.json', {
            version: '1.0',
            accounts: [
                { id: 'cursor-1', email: 'cursor@example.com', membership_type: 'pro', created_at: 30, last_used: 40 },
            ],
        });

        writeJson('github_copilot_accounts.json', {
            version: '1.0',
            accounts: [
                { id: 'gh-1', github_login: 'octocat', github_email: 'octo@example.com', copilot_plan: 'individual' },
            ],
        });

        writeJson('codebuddy_accounts.json', {
            version: '1.0',
            accounts: [
                { id: 'cb-1', email: 'cb@example.com', nickname: 'Buddy', plan_type: 'business' },
            ],
        });

        writeJson('zed_accounts.json', {
            version: '1.0',
            current_account_id: 'zed-1',
            accounts: [
                { id: 'zed-1', github_login: 'zed-dev', display_name: 'Zed Dev', plan_raw: 'team' },
            ],
        });

        writeJson('provider_current_accounts.json', {
            version: '1.0',
            current_accounts: {
                cursor: 'cursor-1',
                github_copilot: 'gh-1',
                codebuddy: 'cb-1',
            },
        });

        const snapshot = readAllCockpitAccounts();

        expect(snapshot.totalAccounts).toBe(5);
        expect(snapshot.sections.map((section) => section.provider)).toEqual([
            'antigravity',
            'cursor',
            'github_copilot',
            'codebuddy',
            'zed',
        ]);

        const cursorSection = snapshot.sections.find((section) => section.provider === 'cursor');
        expect(cursorSection?.currentAccountId).toBe('cursor-1');
        expect(cursorSection?.accounts[0]).toMatchObject({
            id: 'cursor-1',
            email: 'cursor@example.com',
            plan: 'pro',
            isCurrent: true,
        });

        const githubSection = snapshot.sections.find((section) => section.provider === 'github_copilot');
        expect(githubSection?.accounts[0]).toMatchObject({
            email: 'octo@example.com',
            displayName: 'octocat',
            plan: 'individual',
            isCurrent: true,
        });

        const zedSection = snapshot.sections.find((section) => section.provider === 'zed');
        expect(zedSection?.currentAccountId).toBe('zed-1');
        expect(zedSection?.accounts[0]).toMatchObject({
            email: 'zed-dev',
            displayName: 'Zed Dev',
            plan: 'team',
            isCurrent: true,
        });
    });

    it('skips malformed provider files without failing the whole snapshot', () => {
        fs.writeFileSync(path.join(mockedSharedDir, 'qoder_accounts.json'), '{invalid-json', 'utf8');
        writeJson('windsurf_accounts.json', {
            version: '1.0',
            accounts: [
                { id: 'wind-1', github_login: 'wind-user', copilot_plan: 'pro' },
            ],
        });
        writeJson('provider_current_accounts.json', {
            version: '1.0',
            current_accounts: {
                windsurf: 'wind-1',
            },
        });

        const snapshot = readAllCockpitAccounts();

        expect(snapshot.totalAccounts).toBe(1);
        expect(snapshot.sections[0]).toMatchObject({
            provider: 'windsurf',
            currentAccountId: 'wind-1',
        });
        expect(loggerWarn).toHaveBeenCalled();
    });
});
