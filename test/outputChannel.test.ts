import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';
import { MavenOutputChannel } from '../src/outputChannel';

test('keeps readable log levels and timestamps without activating the native log-entry index', () => {
    const writes: string[] = [];
    const sink = { append: (value: string) => writes.push(value) } as unknown as vscode.OutputChannel;
    const output = new MavenOutputChannel(sink, () => 3, () => new Date(2026, 9, 16, 14, 5, 6, 7));
    output.appendLine('[Test Progress] ✓ 1 passed');
    output.warn('[Profiles] Missing profile\nCheck POM\rRetry');
    assert.deepEqual(writes, [
        '[info] 2026-10-16 14:05:06.007 [Test Progress] ✓ 1 passed',
        '\n[warning] 2026-10-16 14:05:06.007 [Profiles] Missing profile\n'
            + '[warning] 2026-10-16 14:05:06.007 Check POM\n'
            + '[warning] 2026-10-16 14:05:06.007 Retry',
    ]);
});

test('follows changes to VS Code log level and suppresses debug output by default', () => {
    const writes: string[] = [];
    let level: vscode.LogLevel = 3;
    const sink = { append: (value: string) => writes.push(value) } as unknown as vscode.OutputChannel;
    const output = new MavenOutputChannel(sink, () => level);
    output.debug('[Discovery] hidden');
    output.appendLine('[Maven] visible');
    level = 2;
    output.debug('[Discovery] visible');
    level = 6;
    output.error('[Runner] hidden');
    assert.equal(writes.length, 2);
    assert.match(writes[0], /^\[info\] .* \[Maven\] visible$/);
    assert.match(writes[1], /^\n\[debug\] .* \[Discovery\] visible$/);
});

test('keeps the tail populated across progress, summary, clear and replace for active filters', () => {
    let content = '';
    const sink = {
        append: (value: string) => { content += value; },
        clear: () => { content = ''; },
        replace: (value: string) => { content = value; },
    } as unknown as vscode.OutputChannel;
    const output = new MavenOutputChannel(sink, () => 3);
    const checkTail = () => assert.notEqual(content.split('\n').at(-1), '',
        'an empty tail can stay hidden when the incremental filter appends matching output');
    output.appendLine('[Maven] noise');
    checkTail();
    const previousTail = content;
    output.appendLine('[Test Progress] ✓ 683 passed │ ✗ 0 failed │ ⊘ 32 skipped │ >> 0 remaining');
    checkTail();
    assert.ok(content.startsWith(`${previousTail}\n\n[info]`),
        'a blank separator changes hidden line ranges before a matching progress message');
    output.appendLine('[Test Progress · Summary] ✓ PASSED │ Σ 715 total │ ✓ 683 passed │ ✗ 0 failed │ ⊗ 0 errors │ ⊘ 32 skipped │ ◷ 1544.8s');
    checkTail();
    assert.equal(content.split('\n').filter(line => line.includes('[Test')).length, 2);
    output.clear();
    output.debug('suppressed');
    output.appendLine('[Maven] next run');
    assert.match(content, /^\[info\]/);
    assert.equal(content.split('\n').length, 1);
    output.replace('[Maven] replacement\r\nsecond line');
    checkTail();
    output.appendLine('[Test Progress · Summary] next summary');
    checkTail();
    assert.equal(content.split('\n').length, 4);
});

test('streams large output without clearing or replacing the displayed model', () => {
    let bytes = 0;
    let count = 0;
    const sink = {
        append: (value: string) => { bytes += Buffer.byteLength(value); count++; },
        clear: () => assert.fail('streaming must not clear logs'),
        replace: () => assert.fail('streaming must not replace the model'),
    } as unknown as vscode.OutputChannel;
    const output = new MavenOutputChannel(sink, () => 3);
    for (let i = 0; i < 100_000; i++) output.appendLine(`[Maven] verbose log ${i} ${'x'.repeat(80)}`);
    output.appendLine('[Test Progress] completed');
    assert.ok(bytes > 10 * 1024 * 1024);
    assert.equal(count, 100_001);
});
