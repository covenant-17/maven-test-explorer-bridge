import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { AGENT_CLIENT_VERSION_RETENTION, pruneAgentClientCache } from '../src/agentClientCache';

test('keeps the current and most recently used previous Agent Bridge versions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mteb-agent-cache-'));
    try {
        createVersion(directory, '1.0.0', 1);
        createVersion(directory, '1.1.0', 3);
        createVersion(directory, '1.2.0', 2);
        fs.mkdirSync(path.join(directory, 'user-data'));

        const result = pruneAgentClientCache(directory, '1.2.0');

        assert.deepEqual(result.removedVersions, ['1.0.0']);
        assert.deepEqual(result.failedVersions, []);
        assert.deepEqual(readDirectories(directory), ['1.1.0', '1.2.0', 'user-data']);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('bounds the cache after many versions while always retaining the current version', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mteb-agent-cache-'));
    try {
        for (let patch = 0; patch < 100; patch += 1) {
            createVersion(directory, `2.0.${patch}`, patch);
        }

        pruneAgentClientCache(directory, '2.0.10');

        const remaining = readDirectories(directory);
        assert.equal(remaining.length, AGENT_CLIENT_VERSION_RETENTION);
        assert.ok(remaining.includes('2.0.10'));
        assert.ok(remaining.includes('2.0.99'));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createVersion(baseDir: string, version: string, modifiedOffsetSeconds: number): void {
    const versionDir = path.join(baseDir, version);
    fs.mkdirSync(versionDir);
    const modifiedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, modifiedOffsetSeconds));
    for (const name of ['cli.js', 'mcp-server.js']) {
        const filePath = path.join(versionDir, name);
        fs.writeFileSync(filePath, version);
        fs.utimesSync(filePath, modifiedAt, modifiedAt);
    }
    fs.utimesSync(versionDir, modifiedAt, modifiedAt);
}

function readDirectories(baseDir: string): string[] {
    return fs.readdirSync(baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}
