import * as vscode from 'vscode';
import { TestTreeBuilder } from './testTreeBuilder';
import { parseReportFile, SuiteResult } from './surefireParser';
import { publishResults } from './resultPublisher';
import { saveRunToHistory } from './runHistory';
import { readSettings } from './settings';
import { WATCHER_DEBOUNCE_MS } from './constants';

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

    function scheduleFlush(uri: vscode.Uri): void {
        pendingUris.add(uri.fsPath);

        if (debounceTimer !== undefined) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
            debounceTimer = undefined;
            const paths = Array.from(pendingUris);
            pendingUris.clear();
            flushReports(paths, controller, treeBuilder, outputChannel, context);
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
        return;
    }

    outputChannel.appendLine(
        `[Watcher] Detected ${xmlPaths.length} XML file(s) — parsed ${results.length} suite(s)`,
    );

    // External run: persist = false (results come from outside VS Code)
    publishResults(controller, treeBuilder, results, outputChannel, undefined);
    if (readSettings().runHistoryEnabled) {
        saveRunToHistory(context, results, 'External (watcher)');
    }
}
