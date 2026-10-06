import * as assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeAgentRun } from '../src/agentRunResults';
import { SuiteResult, TestCaseResult, TestCaseStatus } from '../src/surefireParser';

test('builds stats and failure details for failed and errored Surefire cases', () => {
    const summary = summarizeAgentRun([suite([
        testCase('passes', 'passed'),
        testCase('fails', 'failed', { failureMessage: 'expected true' }),
        testCase('errors', 'error', { stackTrace: '\njava.lang.IllegalStateException: boom\n\tat Example' }),
        testCase('skips', 'skipped'),
    ])]);

    assert.deepEqual(summary.stats, { passed: 1, failed: 1, errors: 1, skipped: 1 });
    assert.deepEqual(summary.failures, [
        { test: 'example.SampleTest#fails', message: 'expected true' },
        { test: 'example.SampleTest#errors', message: 'java.lang.IllegalStateException: boom' },
    ]);
});

test('uses failure type and status fallbacks while excluding synthetic results', () => {
    const summary = summarizeAgentRun([suite([
        testCase('typed', 'failed', { failureType: 'org.opentest4j.AssertionFailedError' }),
        testCase('bare', 'error'),
        { ...testCase('synthetic', 'error'), synthetic: true },
    ])]);

    assert.deepEqual(summary.stats, { passed: 0, failed: 1, errors: 1, skipped: 0 });
    assert.deepEqual(summary.failures.map((failure) => failure.message), [
        'org.opentest4j.AssertionFailedError',
        'Test error',
    ]);
});

function suite(testCases: readonly TestCaseResult[]): SuiteResult {
    return { suiteName: 'example.SampleTest', xmlPath: 'TEST-example.SampleTest.xml', testCases };
}

function testCase(
    methodName: string,
    status: TestCaseStatus,
    overrides: Partial<TestCaseResult> = {},
): TestCaseResult {
    return {
        className: 'example.SampleTest',
        methodName,
        status,
        durationMs: 1,
        failureMessage: undefined,
        failureType: undefined,
        stackTrace: undefined,
        systemOut: undefined,
        systemErr: undefined,
        ...overrides,
    };
}
