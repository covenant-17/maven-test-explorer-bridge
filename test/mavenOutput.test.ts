import assert from 'node:assert/strict';
import test from 'node:test';
import { categorizeMavenOutput, MavenOutputStream } from '../src/mavenOutput';

test('moves the Maven level before a bracketed timestamp so VS Code does not treat seconds as categories', () => {
    assert.equal(
        categorizeMavenOutput('[10:31:14.399] [INFO] Running test'),
        '[INFO] [10:31:14.399] Running test',
    );
    assert.equal(
        categorizeMavenOutput('[2026-10-08 10:31:14,399] [ERROR] Failure'),
        '[ERROR] [2026-10-08 10:31:14,399] Failure',
    );
});

test('preserves Maven levels and uses a stable category for uncategorized output', () => {
    assert.equal(categorizeMavenOutput('[ERROR] Failure'), '[ERROR] Failure');
    assert.equal(
        categorizeMavenOutput('[10:31:14.399] Browser test started'),
        '[Maven] [10:31:14.399] Browser test started',
    );
    assert.equal(categorizeMavenOutput('Downloading dependency'), '[Maven] Downloading dependency');
    assert.equal(categorizeMavenOutput(''), '');
});

test('frames chunks into separate entries and normalizes every timestamp, including ANSI-colored levels', () => {
    const entries: string[] = [];
    const stream = new MavenOutputStream(line => entries.push(categorizeMavenOutput(line)));
    stream.write('[INFO] Starting\n[08:09:06.662] Browser started\r');
    assert.deepEqual(entries, ['[INFO] Starting']);
    stream.write('\n\u001b[32m[08:09:06.663] [INFO]\u001b[0m Running\n[08:09:');
    stream.write('07.907] Browser finished');
    stream.flush();
    stream.flush();
    assert.deepEqual(entries, [
        '[INFO] Starting',
        '[Maven] [08:09:06.662] Browser started',
        '[INFO] [08:09:06.663] Running',
        '[Maven] [08:09:07.907] Browser finished',
    ]);
});

test('keeps stdout and stderr partial lines independent and preserves blank lines', () => {
    const entries: string[] = [];
    const stdout = new MavenOutputStream(line => entries.push(categorizeMavenOutput(line)));
    const stderr = new MavenOutputStream(line => entries.push(categorizeMavenOutput(line)));
    stdout.write('[IN');
    stderr.write('[ERR');
    stdout.write('FO] out\n\n');
    stderr.write('OR] err\n');
    stdout.flush();
    stderr.flush();
    assert.deepEqual(entries, ['[INFO] out', '', '[ERROR] err']);
});

test('large output keeps progress independently filterable with a fixed set of Maven categories', () => {
    const entries: string[] = [];
    const stream = new MavenOutputStream(line => entries.push(categorizeMavenOutput(line)));
    const lines = Array.from({ length: 50_000 }, (_, i) => `[08:09:06.${String(i % 1000).padStart(3, '0')}] log ${i}\n`);
    const text = lines.join('');
    // Pipe chunks cut through both timestamps and line endings.
    for (let offset = 0; offset < text.length; offset += 8191) {
        stream.write(text.slice(offset, offset + 8191));
        if (offset === 0) entries.push('[Test Progress] 1 passed');
    }
    stream.flush();
    assert.equal(entries.length, 50_001);
    assert.deepEqual(entries.filter(entry => entry.includes('[Test')), ['[Test Progress] 1 passed']);
    assert.deepEqual(new Set(entries.map(entry => /^\[([^\]]+)\]/.exec(entry)?.[1])), new Set(['Maven', 'Test Progress']));
    assert.equal(entries.at(-1), '[Maven] [08:09:06.999] log 49999');
});
