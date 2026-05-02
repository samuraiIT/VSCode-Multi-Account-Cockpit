import * as fs from 'fs';
import * as path from 'path';


declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace NodeJS {
        interface Process {
            resourcesPath?: string;
        }
    }
}

/**
 *
 * process.resourcesPath
 *
 */
let resolvedProductJsonPath: string | null | undefined;

function resolveProductJsonPath(): string | null {
    if (resolvedProductJsonPath !== undefined) {
        return resolvedProductJsonPath;
    }
    const resourcesPath = process.resourcesPath;
    if (typeof resourcesPath === 'string' && resourcesPath) {
        resolvedProductJsonPath = path.join(resourcesPath, 'app', 'product.json');
    } else {
        resolvedProductJsonPath = null;
    }
    return resolvedProductJsonPath;
}

let cachedOfficialIdeVersion: string | null | undefined;

export function getOfficialProductJsonPath(): string {
    return resolveProductJsonPath() ?? '(unavailable: process.resourcesPath is undefined)';
}

export function getOfficialIdeVersion(): string | null {
    if (cachedOfficialIdeVersion !== undefined) {
        return cachedOfficialIdeVersion;
    }

    const productJsonPath = resolveProductJsonPath();
    if (!productJsonPath) {
        cachedOfficialIdeVersion = null;
        return null;
    }

    try {
        const raw = fs.readFileSync(productJsonPath, 'utf8');
        const product = JSON.parse(raw) as { ideVersion?: unknown };
        const ideVersion = typeof product.ideVersion === 'string' ? product.ideVersion.trim() : '';
        cachedOfficialIdeVersion = ideVersion || null;
        return cachedOfficialIdeVersion;
    } catch {
        cachedOfficialIdeVersion = null;
        return null;
    }
}
