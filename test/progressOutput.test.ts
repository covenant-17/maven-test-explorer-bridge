import assert from 'node:assert/strict';
import test from 'node:test';
import { formatProgressDateTime } from '../src/progressOutput';

test('formats progress date and time with fixed-width local components', () => {
    const date = new Date(2026, 11, 30, 10, 1, 1);

    assert.equal(formatProgressDateTime(date), '30/12/2026 - 10:01:01');
});

test('pads single-digit date and time components', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    assert.equal(formatProgressDateTime(date), '02/01/2026 - 03:04:05');
});
