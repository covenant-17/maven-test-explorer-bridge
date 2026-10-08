import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRunSummary, formatTestProgress } from '../src/progressOutput';

test('separates progress metrics with vertical bars', () => {
    assert.equal(
        formatTestProgress(2690, 637, 213, 0),
        '[Test Progress] ✓ 2690 passed │ ✗ 637 failed │ ⊘ 213 skipped │ >> 0 remaining',
    );
});

test('omits the remaining segment when its count is unavailable', () => {
    assert.equal(
        formatTestProgress(2, 1, 0, undefined),
        '[Test Progress] ✓ 2 passed │ ✗ 1 failed │ ⊘ 0 skipped',
    );
});

test('formats a successful final run summary with counters and duration', () => {
    assert.equal(
        formatRunSummary('completed', { passed: 471, failed: 0, errors: 0, skipped: 36 }, 9912),
        '[Test Progress · Summary] ✓ PASSED │ Σ 507 total │ ✓ 471 passed │ ✗ 0 failed │ ⊗ 0 errors │ ⊘ 36 skipped │ ◷ 9.9s',
    );
});

test('formats failed and cancelled final run outcomes', () => {
    assert.equal(
        formatRunSummary('failed', { passed: 471, failed: 128, errors: 7, skipped: 36 }, 850),
        '[Test Progress · Summary] ✗ FAILED │ Σ 642 total │ ✓ 471 passed │ ✗ 128 failed │ ⊗ 7 errors │ ⊘ 36 skipped │ ◷ 850ms',
    );
    assert.match(
        formatRunSummary('cancelled', { passed: 1, failed: 0, errors: 0, skipped: 0 }, 1200),
        /^\[Test Progress · Summary\] ■ CANCELLED /,
    );
});
