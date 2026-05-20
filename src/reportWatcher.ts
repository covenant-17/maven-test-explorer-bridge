import * as vscode from 'vscode';
import { TestTreeBuilder } from './testTreeBuilder';
import { parseReportFile, SuiteResult } from './surefireParser';
import { publishResults } from './resultPublisher';
import { saveRunToHistory } from './runHistory';
import { readSettings } from './settings';
import { WATCHER_DEBOUNCE_MS } from './constants';

// XML paths already published by the current UI-triggered run.
// The external watcher skips these to avoid creating a duplicate TestRun.
const _processedByUiRun = new Set<string>();

/** Called by UI run: registers xmlPaths so the external watcher skips them. */
export function registerUiRunXmlPaths(paths: readonly string[]): void {
    for (const p of paths) { _processedByUiRun.add(p); }
}

/** Called by UI run when it finishes: clears the registry after a short delay
 * so any straggling watcher events are still suppressed. */
export function clearUiRunXmlPaths(): void {
    setTimeout(() => _processedByUiRun.clear(), 1500);
}

/**
 * Starts file system watchers for Surefire/Failsafe XML report files.
 *
 * When Maven runs externally (terminal, Claude Code, task runner), the watcher
 * detects new or changed report files, parses them, and automatically updates
 * the VS Code Testing sidebar — without requiring the user to manually refresh.
 *
 * A 500ms debounce is applied to batch the many simultaneous writes that Maven
 * produces at the end of a test run.
 */
export function startReportWatcher(
    controller: vscode.TestController,
    treeBuilder: TestTreeBuilder,
    outputChannel: vscode.OutputChannel,
    context: vscode.ExtensionContext,
): void {
    const settings = readSettings();

    if (!settings.watchReports) {
        return;
    }

    const pendingUris = new Set<string>();
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let activeExternalRun: vscode.TestRun | undefined;

    function scheduleFlush(uri: vscode.Uri): void {
        // Fast path: skip XMLs already claimed by a UI-triggered run
        if (_processedByUiRun.has(uri.fsPath)) {
            return;
        }

        const isFirstInBatch = pendingUris.size === 0;
        pendingUris.add(uri.fsPath);

        // On the first XML of a new external batch: open a TestRun and show spinners
        // for all known method items so the sidebar reflects an in-progress state.
        if (isFirstInBatch && activeExternalRun === undefined) {
            activeExternalRun = controller.createTestRun(
                new vscode.TestRunRequest(),
                'Maven Surefire Results',
                false,
            );
            for (const item of treeBuilder.getAllMethodItems()) {
                activeExternalRun.started(item);
            }
        }

        if (debounceTimer !== undefined) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
            debounceTimer = undefined;
            const paths = Array.from(pendingUris).filter((p) => !_processedByUiRun.has(p));
            pendingUris.clear();
            const run = activeExternalRun;
            activeExternalRun = undefined;
            if (paths.length === 0) {
                run?.end();
                return;
            }
            flushReports(paths, controller, treeBuilder, outputChannel, context, run);
        }, WATCHER_DEBOUNCE_MS);
    }

    const folders = vscode.workspace.workspaceFolders ?? [];

    for (const folder of folders) {
        for (const glob of settings.reportGlobs) {
            const pattern = new vscode.RelativePattern(folder, glob);
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            watcher.onDidCreate((uri) => scheduleFlush(uri));
            watcher.onDidChange((uri) => scheduleFlush(uri));
            watcher.onDidDelete((uri) => {
                // Remove any pending entry for this file
                pendingUris.delete(uri.fsPath);
            });

            context.subscriptions.push(watcher);
        }
    }

    outputChannel.appendLine(`[Watcher] Watching ${settings.reportGlobs.join(', ')}`);
}

// -------------------------------------------------------------------------
// Private helpers
// -------------------------------------------------------------------------

function flushReports(
    xmlPaths: readonly string[],
    controller: vscode.TestController,
    treeBuilder: TestTreeBuilder,
    outputChannel: vscode.OutputChannel,
    context: vscode.ExtensionContext,
    existingRun?: vscode.TestRun,
): void {
    const results: SuiteResult[] = [];

    for (const xmlPath of xmlPaths) {
        const result = parseReportFile(xmlPath);
        if (result) {
            results.push(result);
        } else {
            outputChannel.appendLine(`[Watcher] Failed to parse: ${xmlPath}`);
        }
    }

    if (results.length === 0) {
        existingRun?.end();
        return;
    }

    outputChannel.appendLine(
        `[Watcher] Detected ${xmlPaths.length} XML file(s) — parsed ${results.length} suite(s)`,
    );

    // External run: persist = false (results come from outside VS Code).
    // Pass existingRun so publishResults reuses it; we then end it ourselves since
    // publishResults only auto-ends runs it creates internally.
    publishResults(controller, treeBuilder, results, outputChannel, undefined, false, existingRun);
    if (existingRun) {
        existingRun.end();
    }
    if (readSettings().runHistoryEnabled) {
        saveRunToHistory(context, results, 'External (watcher)');
    }
}
