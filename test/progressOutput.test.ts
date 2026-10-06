import assert from 'node:assert/strict';
import test from 'node:test';
import { formatProgressDateTime, formatTestProgress } from '../src/progressOutput';

test('formats progress date and time with fixed-width local components', () => {
    const date = new Date(2026, 11, 30, 10, 1, 1);

    assert.equal(formatProgressDateTime(date), '30/12/2026 - 10:01:01');
});

test('pads single-digit date and time components', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    assert.equal(formatProgressDateTime(date), '02/01/2026 - 03:04:05');
});

test('separates progress metrics and timestamp with vertical bars', () => {
    const date = new Date(2026, 9, 6, 11, 8, 6);

    assert.equal(
        formatTestProgress(2690, 637, 213, 0, date),
        '[Test Progress] ✓ 2690 passed │ ✗ 637 failed │ ⊘ 213 skipped │ ⏳ 0 remaining │ 06/10/2026 - 11:08:06',
    );
});

test('keeps the timestamp separated when remaining count is unavailable', () => {
    const date = new Date(2026, 9, 6, 11, 8, 6);

    assert.equal(
        formatTestProgress(2, 1, 0, undefined, date),
        '[Test Progress] ✓ 2 passed │ ✗ 1 failed │ ⊘ 0 skipped │ 06/10/2026 - 11:08:06',
    );
});
