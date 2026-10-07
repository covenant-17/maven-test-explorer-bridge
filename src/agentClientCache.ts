import * as fs from 'fs';
import * as path from 'path';

export const AGENT_CLIENT_VERSION_RETENTION = 2;

export interface AgentClientCachePruneResult {
    readonly removedVersions: readonly string[];
    readonly failedVersions: readonly { version: string; error: unknown }[];
}

interface VersionDirectory {
    readonly version: string;
    readonly path: string;
    readonly modifiedAt: number;
}

export function pruneAgentClientCache(
    baseDir: string,
    currentVersion: string,
    retention = AGENT_CLIENT_VERSION_RETENTION,
): AgentClientCachePruneResult {
    const versionDirectories = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && isManagedVersion(entry.name))
        .map((entry): VersionDirectory => {
            const directoryPath = path.join(baseDir, entry.name);
            return {
                version: entry.name,
                path: directoryPath,
                modifiedAt: latestManagedFileModification(directoryPath),
            };
        });

    const keep = new Set<string>([currentVersion]);
    const previousVersionsToKeep = Math.max(0, retention - 1);
    versionDirectories
        .filter((entry) => entry.version !== currentVersion)
        .sort((left, right) => right.modifiedAt - left.modifiedAt
            || right.version.localeCompare(left.version, undefined, { numeric: true }))
        .slice(0, previousVersionsToKeep)
        .forEach((entry) => keep.add(entry.version));

    const removedVersions: string[] = [];
    const failedVersions: { version: string; error: unknown }[] = [];
    for (const entry of versionDirectories) {
        if (keep.has(entry.version)) continue;
        try {
            fs.rmSync(entry.path, { recursive: true, force: true });
            removedVersions.push(entry.version);
        } catch (error) {
            failedVersions.push({ version: entry.version, error });
        }
    }
    return { removedVersions, failedVersions };
}

function isManagedVersion(name: string): boolean {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(name);
}

function latestManagedFileModification(directoryPath: string): number {
    let modifiedAt = fs.statSync(directoryPath).mtimeMs;
    for (const name of ['cli.js', 'mcp-server.js']) {
        const filePath = path.join(directoryPath, name);
        if (fs.existsSync(filePath)) {
            modifiedAt = Math.max(modifiedAt, fs.statSync(filePath).mtimeMs);
        }
    }
    return modifiedAt;
}
