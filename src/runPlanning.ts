export type RunOutcome = 'completed' | 'failed' | 'cancelled';

export interface MavenExecutionRecord {
    readonly moduleKey: string;
    readonly moduleDir: string;
    readonly exitCode: number;
}

export function ensureNonRecursiveArgs(args: readonly string[], enabled: boolean): string[] {
    if (!enabled || args.includes('-N') || args.includes('--non-recursive') || args.length === 0) {
        return [...args];
    }
    return [args[0], '-N', ...args.slice(1)];
}

export function determineRunOutcome(
    cancelled: boolean,
    executions: readonly MavenExecutionRecord[],
): RunOutcome {
    if (cancelled) {
        return 'cancelled';
    }
    return executions.some((execution) => execution.exitCode !== 0) ? 'failed' : 'completed';
}

export function shouldPersistRun(outcome: RunOutcome, suiteCount: number): boolean {
    return suiteCount > 0 || outcome !== 'completed';
}

export function reportsStillMatchLastRun(
    changedResults: readonly SuiteResult[],
    lastRunResults: readonly SuiteResult[],
): boolean {
    if (changedResults.length === 0 || changedResults.length !== lastRunResults.length) {
        return false;
    }
    const previousByPath = new Map(lastRunResults.map((suite) => [reportKey(suite.xmlPath), suite]));
    return changedResults.every((suite) => {
        const previous = previousByPath.get(reportKey(suite.xmlPath));
        return previous !== undefined
            && JSON.stringify(withoutSyntheticCases(previous)) === JSON.stringify(withoutSyntheticCases(suite));
    });
}

function withoutSyntheticCases(suite: SuiteResult): SuiteResult {
    return {
        ...suite,
        testCases: suite.testCases.filter((testCase) => !testCase.synthetic),
    };
}

function reportKey(xmlPath: string): string {
    const normalized = path.normalize(xmlPath);
    return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}
import * as path from 'path';
import type { SuiteResult } from './surefireParser';
