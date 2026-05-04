import * as vscode from 'vscode';
import { SuiteResult, TestCaseStatus } from './surefireParser';

const HISTORY_STATE_KEY = 'mavenTestExplorer.runHistory';
const MAX_HISTORY_ENTRIES = 20;

export interface RunHistoryEntry {
    readonly id: string;
    readonly label: string;
    readonly timestamp: number;
    readonly source: string;
    readonly suiteResults: readonly SuiteResult[];
}

interface RunStats {
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
}

function computeStats(suiteResults: readonly SuiteResult[]): RunStats {
    const stats: RunStats = { passed: 0, failed: 0, errors: 0, skipped: 0 };
    for (const suite of suiteResults) {
        for (const tc of suite.testCases) {
            const status: TestCaseStatus = tc.status;
            if (status === 'passed')       { stats.passed++;  }
            else if (status === 'failed')  { stats.failed++;  }
            else if (status === 'error')   { stats.errors++;  }
            else if (status === 'skipped') { stats.skipped++; }
        }
    }
    return stats;
}

/**
 * Saves a completed test run to workspace-scoped history.
 * Silently skips empty result sets.
 */
export function saveRunToHistory(
    context: vscode.ExtensionContext,
    suiteResults: readonly SuiteResult[],
    source: string,
): void {
    if (suiteResults.length === 0) {
        return;
    }

    const stats = computeStats(suiteResults);
    const total = stats.passed + stats.failed + stats.errors + stats.skipped;
    const timestamp = Date.now();
    const dateStr = new Date(timestamp).toLocaleString();

    const parts: string[] = [];
    if (stats.passed  > 0) { parts.push(`${stats.passed} passed`);  }
    if (stats.failed  > 0) { parts.push(`${stats.failed} failed`);  }
    if (stats.errors  > 0) { parts.push(`${stats.errors} errors`);  }
    if (stats.skipped > 0) { parts.push(`${stats.skipped} skipped`); }

    const label = `${dateStr}  —  ${total} tests: ${parts.join(', ')}`;

    const entry: RunHistoryEntry = { id: `run-${timestamp}`, label, timestamp, source, suiteResults };
    const history = loadHistory(context);
    const updated = [entry, ...history].slice(0, MAX_HISTORY_ENTRIES);
    context.workspaceState.update(HISTORY_STATE_KEY, updated);
}

/**
 * Returns all stored run history entries, newest first.
 */
export function loadHistory(context: vscode.ExtensionContext): RunHistoryEntry[] {
    return context.workspaceState.get<RunHistoryEntry[]>(HISTORY_STATE_KEY) ?? [];
}

/**
 * Deletes all stored history entries.
 */
export function clearHistory(context: vscode.ExtensionContext): void {
    context.workspaceState.update(HISTORY_STATE_KEY, []);
}
