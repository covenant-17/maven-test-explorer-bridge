import * as vscode from 'vscode';
import { TestTreeBuilder } from './testTreeBuilder';
import { SuiteResult, TestCaseResult, TestCaseStatus } from './surefireParser';

// Pattern to detect JUnit "expected:<X> but was:<Y>" assertion failures
const ASSERTION_DIFF_PATTERN = /expected:\s*<(.+?)>\s+but was:\s*<(.+?)>/i;

// Pattern to extract Java stack frame: "  at com.example.MyClass.method(MyClass.java:42)"
const STACK_FRAME_PATTERN = /at\s+([\w.$]+)\.([\w$<>]+)\((\S+\.java):(\d+)\)/g;

/**
 * Publishes a set of SuiteResult objects to the VS Code Testing API.
 *
 * @param controller  The TestController that owns the test run.
 * @param treeBuilder Used to look up TestItems by class/method name.
 * @param suiteResults Parsed Surefire XML results.
 * @param outputChannel Output channel for logging summary.
 * @param runRequest   If provided (UI-triggered run), the results are persisted.
 *                     If undefined (watcher/external run), a fresh request is created and not persisted.
 */
export function publishResults(
    controller: vscode.TestController,
    treeBuilder: TestTreeBuilder,
    suiteResults: readonly SuiteResult[],
    outputChannel: vscode.OutputChannel,
    runRequest?: vscode.TestRunRequest,
    persist?: boolean,
): void {
    const request = runRequest ?? new vscode.TestRunRequest();
    const shouldPersist = persist ?? (runRequest !== undefined);
    const run = controller.createTestRun(request, 'Maven Surefire Results', shouldPersist);

    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalError = 0;

    try {
        for (const suite of suiteResults) {
            for (const tc of suite.testCases) {
                reportTestCase(run, treeBuilder, tc, outputChannel);
                switch (tc.status) {
                    case 'passed':  totalPassed++;  break;
                    case 'failed':  totalFailed++;  break;
                    case 'error':   totalError++;   break;
                    case 'skipped': totalSkipped++; break;
                }
            }
        }
    } finally {
        run.end();
    }

    const total = totalPassed + totalFailed + totalError + totalSkipped;
    outputChannel.appendLine(
        `[Results] ${total} tests — ` +
        `${totalPassed} passed, ${totalFailed} failed, ${totalError} errors, ${totalSkipped} skipped`,
    );

    treeBuilder.updateAggregates(suiteResults);
}

// -------------------------------------------------------------------------
// Private helpers
// -------------------------------------------------------------------------

function reportTestCase(
    run: vscode.TestRun,
    treeBuilder: TestTreeBuilder,
    tc: TestCaseResult,
    outputChannel: vscode.OutputChannel,
): void {
    const item = treeBuilder.findMethodItem(tc.className, tc.methodName)
        ?? treeBuilder.findClassItem(tc.className);

    if (!item) {
        outputChannel.appendLine(`[Results] No TestItem found for: ${tc.className}#${tc.methodName}`);
        return;
    }

    appendTestOutput(run, item, tc);

    switch (tc.status) {
        case 'passed':
            run.passed(item, tc.durationMs);
            break;

        case 'skipped':
            run.skipped(item);
            break;

        case 'failed':
        case 'error': {
            const message = buildTestMessage(tc, item);
            if (tc.status === 'failed') {
                run.failed(item, message, tc.durationMs);
            } else {
                run.errored(item, message, tc.durationMs);
            }
            break;
        }
    }
}

function buildTestMessage(tc: TestCaseResult, item: vscode.TestItem): vscode.TestMessage {
    const rawMessage = tc.failureMessage ?? tc.failureType ?? 'Test failed';

    // Use diff view when JUnit assertion message contains expected/actual values
    const diffMatch = ASSERTION_DIFF_PATTERN.exec(rawMessage);
    let message: vscode.TestMessage;
    if (diffMatch) {
        message = vscode.TestMessage.diff(
            new vscode.MarkdownString(`**${escapeMarkdown(rawMessage)}**`),
            diffMatch[1],
            diffMatch[2],
        );
    } else {
        message = new vscode.TestMessage(
            buildMarkdownMessage(rawMessage, tc.failureType, tc.stackTrace),
        );
    }

    // Set location to the test item's source position for "Go to failure" navigation
    if (item.uri) {
        const position = item.range?.start ?? new vscode.Position(0, 0);
        message.location = new vscode.Location(item.uri, position);
    }

    // Build structured stack frames for VS Code stack trace navigation
    if (tc.stackTrace) {
        message.stackTrace = buildStackFrames(tc.stackTrace);
    }

    return message;
}

function buildMarkdownMessage(
    failureMessage: string,
    failureType: string | undefined,
    stackTrace: string | undefined,
): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;

    if (failureType) {
        md.appendMarkdown(`**${escapeMarkdown(failureType)}**\n\n`);
    }
    md.appendMarkdown(`${escapeMarkdown(failureMessage)}\n`);

    if (stackTrace) {
        md.appendMarkdown('\n```\n');
        md.appendMarkdown(stackTrace);
        md.appendMarkdown('\n```\n');
    }

    return md;
}

function buildStackFrames(stackTrace: string): vscode.TestMessageStackFrame[] {
    const frames: vscode.TestMessageStackFrame[] = [];
    let match: RegExpExecArray | null;

    STACK_FRAME_PATTERN.lastIndex = 0;
    while ((match = STACK_FRAME_PATTERN.exec(stackTrace)) !== null) {
        const fqcn = match[1];
        const method = match[2];
        const fileName = match[3];
        const lineNumber = parseInt(match[4], 10);

        frames.push(
            new vscode.TestMessageStackFrame(
                `${fqcn}.${method}(${fileName}:${lineNumber})`,
                undefined,       // URI resolved at click-time by VS Code
                new vscode.Position(lineNumber - 1, 0),
            ),
        );
    }

    return frames;
}

function appendTestOutput(run: vscode.TestRun, item: vscode.TestItem, tc: TestCaseResult): void {
    if (tc.systemOut) {
        run.appendOutput(`[stdout] ${tc.systemOut}\r\n`, undefined, item);
    }
    if (tc.systemErr) {
        run.appendOutput(`[stderr] ${tc.systemErr}\r\n`, undefined, item);
    }
}

function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
}
