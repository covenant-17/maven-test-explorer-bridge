import type { SuiteResult } from './surefireParser';

export interface RunResultView {
    readonly baseResults: readonly SuiteResult[];
    readonly runtimeResults: readonly SuiteResult[];
    readonly runningNodeIds: ReadonlySet<string>;
}

/**
 * Keeps a historical snapshot isolated from the live run overlay.
 */
export function resolveRunResultView(
    cachedResults: readonly SuiteResult[],
    runtimeResults: readonly SuiteResult[],
    runningNodeIds: ReadonlySet<string>,
    historicalResults?: readonly SuiteResult[],
): RunResultView {
    if (historicalResults) {
        return {
            baseResults: historicalResults,
            runtimeResults: [],
            runningNodeIds: new Set(),
        };
    }
    return {
        baseResults: cachedResults,
        runtimeResults,
        runningNodeIds,
    };
}
