import { AgentRunFailure, AgentRunStats } from './agentProtocol';
import { SuiteResult, TestCaseResult } from './surefireParser';

export interface AgentRunResultSummary {
    readonly stats: AgentRunStats;
    readonly failures: readonly AgentRunFailure[];
}

export function summarizeAgentRun(suiteResults: readonly SuiteResult[]): AgentRunResultSummary {
    const stats = { passed: 0, failed: 0, errors: 0, skipped: 0 };
    const failures: AgentRunFailure[] = [];
    for (const suite of suiteResults) {
        for (const testCase of suite.testCases) {
            if (testCase.synthetic) continue;
            if (testCase.status === 'passed') stats.passed++;
            else if (testCase.status === 'failed') stats.failed++;
            else if (testCase.status === 'error') stats.errors++;
            else if (testCase.status === 'skipped') stats.skipped++;

            if (testCase.status === 'failed' || testCase.status === 'error') {
                failures.push({
                    test: `${testCase.className}#${testCase.methodName}`,
                    message: failureReason(testCase),
                });
            }
        }
    }
    return { stats, failures };
}

function failureReason(testCase: TestCaseResult): string {
    return testCase.failureMessage
        ?? firstNonEmptyLine(testCase.stackTrace)
        ?? testCase.failureType
        ?? (testCase.status === 'error' ? 'Test error' : 'Test failed');
}

function firstNonEmptyLine(value: string | undefined): string | undefined {
    return value?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}
