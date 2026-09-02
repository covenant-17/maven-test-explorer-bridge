import assert from 'node:assert/strict';
import test from 'node:test';
import { testCaseResultFingerprint } from '../src/resultPublication';
import type { TestCaseResult } from '../src/surefireParser';

const result = (overrides: Partial<TestCaseResult> = {}): TestCaseResult => ({
    className: 'com.example.SampleTest',
    methodName: 'works',
    status: 'passed',
    durationMs: 1,
    failureMessage: undefined,
    failureType: undefined,
    stackTrace: undefined,
    systemOut: undefined,
    systemErr: undefined,
    ...overrides,
});

test('live result fingerprint suppresses an unchanged final publication', () => {
    assert.equal(testCaseResultFingerprint(result()), testCaseResultFingerprint(result()));
});

test('live result fingerprint changes when inline diagnostics or output changes', () => {
    const initial = testCaseResultFingerprint(result());
    assert.notEqual(initial, testCaseResultFingerprint(result({ status: 'failed', failureMessage: 'boom' })));
    assert.notEqual(initial, testCaseResultFingerprint(result({ systemOut: 'method log' })));
});
