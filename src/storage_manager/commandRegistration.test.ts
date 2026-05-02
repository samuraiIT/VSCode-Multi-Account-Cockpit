import * as fs from 'fs';
import * as path from 'path';

function extractDeclaredMultiCockpitCommands(packageJson: unknown): string[] {
    const manifest = packageJson as {
        contributes?: {
            commands?: Array<{ command?: string }>;
        };
    };

    return (manifest.contributes?.commands ?? [])
        .map((item: { command?: string }) => item.command)
        .filter((command: unknown): command is string => typeof command === 'string' && command.startsWith('multiCockpit.'));
}

function extractRuntimeMultiCockpitCommands(sourceText: string): string[] {
    const matches = sourceText.match(/registerCommand\(`\$\{CMD\}\.([^`]+)`/g) ?? [];
    return matches.map((match) => `multiCockpit.${match.match(/registerCommand\(`\$\{CMD\}\.([^`]+)`/)?.[1] ?? ''}`);
}

describe('storage_manager command registration', () => {
    it('registers every public multiCockpit command declared in package.json', () => {
        const repoRoot = path.resolve(__dirname, '..', '..');
        const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
        const storageManagerSource = fs.readFileSync(path.join(repoRoot, 'src', 'storage_manager', 'index.ts'), 'utf8');

        const declaredCommands = extractDeclaredMultiCockpitCommands(packageJson).sort();
        const runtimeCommands = new Set(extractRuntimeMultiCockpitCommands(storageManagerSource));

        const missing = declaredCommands.filter((command) => !runtimeCommands.has(command));
        expect(missing).toEqual([]);
    });
});
