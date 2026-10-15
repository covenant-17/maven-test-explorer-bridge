import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';
import { runMaven } from '../src/mavenRunner';

test('runner emits independent log entries under heavy output, preserves UTF-8 and flushes final progress', async () => {
    const entries: string[] = [];
    const raw: string[] = [];
    const completed: string[] = [];
    const channel = {
        appendLine: (line: string) => entries.push(line),
        append: () => assert.fail('pipe chunks must not be appended as log entries'),
    } as unknown as vscode.OutputChannel;
    const token = {
        onCancellationRequested: () => ({ dispose() {} }),
    } as unknown as vscode.CancellationToken;
    const script = `
        const fs = require('node:fs');
        const text = Array.from({ length: 20000 }, (_, i) => '[08:09:06.662] noisy ' + i + '\\n').join('');
        fs.writeSync(1, text);
        fs.writeSync(2, '[08:09:07.907] stderr\\nlast error');
        const unicode = Buffer.from('Привет ✓\\n');
        fs.writeSync(1, unicode.subarray(0, 1));
        fs.writeSync(1, unicode.subarray(1));
        fs.writeSync(1, '[INFO] Tests run: 2, Failures: 0, Errors: 0, Skipped: 0 -- in tests.Example');
    `;
    const result = await runMaven(process.cwd(), [process.execPath, '-e', script], channel, token, 2, {
        onOutput: text => raw.push(text),
        onClassCompleted: name => completed.push(name),
    });
    assert.equal(result.exitCode, 0);
    const noisyEntries = entries.filter(line => line.startsWith('[Maven] [08:09:06.662]'));
    assert.equal(noisyEntries.length, 20000);
    assert.ok(noisyEntries.every(line => !/[\r\n]/.test(line)));
    assert.ok(entries.includes('[Maven] Привет ✓'));
    assert.ok(entries.includes('[Maven] [08:09:07.907] stderr'));
    assert.ok(entries.includes('[Maven] last error'));
    assert.deepEqual(completed, ['tests.Example']);
    const progressEntries = entries.filter(line => line.startsWith('[Test Progress]'));
    assert.equal(progressEntries.length, 1);
    assert.match(progressEntries[0], /2 passed/);
    assert.ok(entries.indexOf(progressEntries[0]) < entries.indexOf('[Maven] Exited with code 0'));
    assert.ok(raw.join('').includes('Привет ✓'));
});
