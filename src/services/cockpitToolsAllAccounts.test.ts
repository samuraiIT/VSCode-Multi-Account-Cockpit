import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getCockpitToolsSharedDir } from '../shared/antigravity_paths';
import { readAllCockpitAccounts } from './cockpitToolsAllAccounts';

jest.mock('../shared/antigravity_paths', () => ({
    getCockpitToolsSharedDir: jest.fn(),
}));

jest.mock('../shared/log_service', () => ({
    logger: {
        debug: jest.fn(),
        warn: jest.fn(),
    },
}));

const mockedGetCockpitToolsSharedDir = getCockpitToolsSharedDir as jest.MockedFunction<typeof getCockpitToolsSharedDir>;

function writeIndex(tempDir: string, fileName: string, payload: unknown): void {
    fs.writeFileSync(path.join(tempDir, fileName), JSON.stringify(payload, null, 2), 'utf8');
}

describe('cockpitToolsAllAccounts', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-tools-accounts-'));
        mockedGetCockpitToolsSharedDir.mockReturnValue(tempDir);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        jest.clearAllMocks();
    });

    it('reads all supported provider index files and maps current flags safely', () => {
        writeIndex(tempDir, 'accounts.json', {
            version: '2.0',
            current_account_id: 'ag-1',
            accounts: [{ id: 'ag-1', email: 'ag@example.com', name: 'AG', created_at: 1, last_used: 2 }],
        });
        writeIndex(tempDir, 'codex_accounts.json', {
            version: '1.0',
            current_account_id: 'codex-1',
            accounts: [{ id: 'codex-1', email: 'codex@example.com', plan_type: 'plus', created_at: 1, last_used: 2 }],
        });
        writeIndex(tempDir, 'cursor_accounts.json', {
            version: '1.0',
            accounts: [{ id: 'cursor-1', email: 'cursor@example.com', membership_type: 'pro', created_at: 1, last_used: 2 }],
        });
        writeIndex(tempDir, 'github_copilot_accounts.json', {
            version: '1.0',
            accounts: [{ id: 'gh-1', github_login: 'ghlogin', github_email: 'gh@example.com', copilot_plan: 'individual', created_at: 1, last_used: 2 }],
        });
        writeIndex(tempDir, 'windsurf_accounts.json', {
            version: '1.0',
            accounts: [{ id: 'wind-1', github_login: 'windlogin', github_email: 'wind@example.com', copilot_plan: 'team', created_at: 1, last_used: 2 }],
        });
        writeIndex(tempDir, 'kiro_accounts.json', {
            version: '1.0',
            accounts: [{ id: 'kiro-1', email: 'kiro@example.com', plan_name: 'starter', created_at: 1, last_used: 2 }],
        });
        writeIndex(tempDir, 'gemini_accounts.json', {
            version: '1.0',
            accounts: [{ id: 'gem-1', email: 'gemini@example.com', plan_name: 'pro', created_at: 1, last_used: 2 }],
        });
        writeIndex(tempDir, 'codebuddy_accounts.json', {
            version: '1.0',
            accounts: [{ id: 'cb-1', email: 'cb@example.com', plan_type: 'business', created_at: 1, last_used: 2 }],
        });
        // Legacy fallback for codebuddy_cn provider.
        writeIndex(tempDir, 'workbuddy_accounts.json', {
            version: '1.0',
            accounts: [{ id: 'cbcn-1', email: 'cbcn@example.com', plan_type: 'pro', created_at: 1, last_used: 2 }],
        });
        writeIndex(tempDir, 'qoder_accounts.json', {
            version: '1.0',
            accounts: [{ id: 'qoder-1', email: 'qoder@example.com', plan_type: 'pro', created_at: 1, last_used: 2 }],
        });
        writeIndex(tempDir, 'trae_accounts.json', {
            version: '1.0',
            accounts: [{ id: 'trae-1', email: 'trae@example.com', plan_type: 'free', created_at: 1, last_used: 2 }],
        });
        writeIndex(tempDir, 'zed_accounts.json', {
            version: '1.0',
            current_account_id: 'zed-1',
            accounts: [{ id: 'zed-1', github_login: 'zedlogin', plan_raw: 'zed-pro', created_at: 1, last_used: 2 }],
        });

        const snapshot = readAllCockpitAccounts();
        const sections = new Map(snapshot.sections.map((section) => [section.provider, section]));

        expect(snapshot.totalAccounts).toBe(12);
        expect(sections.size).toBe(12);
        expect(sections.get('antigravity')?.accounts[0]?.isCurrent).toBe(true);
        expect(sections.get('codex')?.accounts[0]?.isCurrent).toBe(true);
        expect(sections.get('zed')?.accounts[0]?.isCurrent).toBe(true);
        expect(sections.get('cursor')?.accounts[0]?.isCurrent).toBe(false);
        expect(sections.get('github_copilot')?.accounts[0]?.isCurrent).toBe(false);
        expect(sections.get('codebuddy_cn')?.accounts[0]?.email).toBe('cbcn@example.com');
        expect(sections.get('zed')?.accounts[0]?.email).toBe('zedlogin');
    });

    it('ignores malformed provider files and still returns available sections', () => {
        fs.writeFileSync(path.join(tempDir, 'codex_accounts.json'), '{invalid json', 'utf8');
        writeIndex(tempDir, 'accounts.json', {
            version: '2.0',
            current_account_id: 'ag-1',
            accounts: [{ id: 'ag-1', email: 'ag@example.com', created_at: 1, last_used: 2 }],
        });

        const snapshot = readAllCockpitAccounts();
        expect(snapshot.totalAccounts).toBe(1);
        expect(snapshot.sections).toHaveLength(1);
        expect(snapshot.sections[0].provider).toBe('antigravity');
    });
});
