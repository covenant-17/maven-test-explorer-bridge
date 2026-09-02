import type { TestCaseResult } from './surefireParser';

export function testCaseResultFingerprint(tc: TestCaseResult): string {
    return JSON.stringify([
        tc.status,
        tc.durationMs,
        tc.failureMessage,
        tc.failureType,
        tc.stackTrace,
        tc.systemOut,
        tc.systemErr,
        Boolean(tc.synthetic),
    ]);
}
