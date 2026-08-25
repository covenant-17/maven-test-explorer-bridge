import * as vscode from 'vscode';
import { InlineTestBridge } from './inlineTestBridge';
import { SuiteResult, TestCaseResult } from './surefireParser';

// Pattern to detect JUnit "expected:<X> but was:<Y>" assertion failures
const ASSERTION_DIFF_PATTERN = /expected:\s*<(.+?)>\s+but was:\s*<(.+?)>/i;

// Pattern to extract Java stack frame: "  at com.example.MyClass.method(MyClass.java:42)"
const STACK_FRAME_PATTERN = /at\s+([\w.$]+)\.([\w$<>]+)\((\S+\.java):(\d+)\)/g;

/**
 * Publishes a set of SuiteResult objects to the VS Code Testing API.
 *
 * @param controller  The TestController that owns the test run.
 * @param inlineBridge Used to look up TestItems by class/method name.
 * @param suiteResults Parsed Surefire XML results.
 * @param outputChannel Output channel for logging summary.
 * @param runRequest   If provided (UI-triggered run), the results are persisted.
 *                     If undefined (watcher/external run), a fresh request is created and not persisted.
 */
export function publishResults(
    controller: vscode.TestController | undefined,
    inlineBridge: InlineTestBridge,
    suiteResults: readonly SuiteResult[],
    outputChannel: vscode.OutputChannel,
    runRequest?: vscode.TestRunRequest,
    persist?: boolean,
    existingRun?: vscode.TestRun,
    sharedInvocationCounts?: Map<string, number>,
): Set<string> {
    const resolvedItemIds = new Set<string>();
    const ownRun = existingRun === undefined;
    let run: vscode.TestRun;
    if (existingRun) {
        run = existingRun;
    } else {
        const request = runRequest ?? new vscode.TestRunRequest();
        const shouldPersist = persist ?? (runRequest !== undefined);
        run = controller!.createTestRun(request, 'Maven Surefire Results', shouldPersist);
    }

    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalError = 0;

    try {
        // If a shared map is provided (UI run across multiple XML files), use it so
        // Surefire's duplication of parent-class tests into nested-class XMLs is
        // suppressed — each unique classname#method is only reported once per run.
        // For standalone calls (external watcher), create a fresh per-file map.
        const invocationCounts = sharedInvocationCounts ?? new Map<string, number>();
        for (const suite of suiteResults) {
            for (const tc of suite.testCases) {
                const item = reportTestCase(run, inlineBridge, suite, tc, outputChannel, invocationCounts);
                if (item) { resolvedItemIds.add(item.id); }
                if (tc.synthetic) { continue; }
                switch (tc.status) {
                    case 'passed':  totalPassed++;  break;
                    case 'failed':  totalFailed++;  break;
                    case 'error':   totalError++;   break;
                    case 'skipped': totalSkipped++; break;
                }
            }
        }
    } finally {
        if (ownRun) {
            run.end();
        }
    }

    const total = totalPassed + totalFailed + totalError + totalSkipped;
    outputChannel.appendLine(
        `[Results] ${total} tests — ` +
        `${totalPassed} passed, ${totalFailed} failed, ${totalError} errors, ${totalSkipped} skipped`,
    );

    return resolvedItemIds;
}

// -------------------------------------------------------------------------
// Private helpers
// -------------------------------------------------------------------------

function reportTestCase(
    run: vscode.TestRun,
    inlineBridge: InlineTestBridge,
    suite: SuiteResult,
    tc: TestCaseResult,
    outputChannel: vscode.OutputChannel,
    invocationCounts: Map<string, number>,
): vscode.TestItem | undefined {
    // For @TestFactory: the same method name appears multiple times in the XML.
    // Track invocation count and suffix with [N] for N > 1 so each dynamic
    // test gets its own TestItem in the run counter.
    // For @ParameterizedTest: XML already contains unique names like
    // "greetMultipleNames(String)[1]" — those go through getOrCreateMethodItem
    // as-is and each gets its own dynamic TestItem.
    const moduleKey = inlineBridge.resolveModuleKey(suite.xmlPath, tc.className);
    if (!moduleKey) {
        outputChannel.appendLine(`[Results] NO MODULE: ${tc.className} (${suite.xmlPath})`);
        return undefined;
    }
    const baseKey = `${moduleKey}\0${tc.className}#${tc.methodName}`;
    const count = (invocationCounts.get(baseKey) ?? 0) + 1;
    invocationCounts.set(baseKey, count);
    const effectiveName = count > 1 ? `${tc.methodName}[${count}]` : tc.methodName;

    // Resolve the target TestItem:
    //  1. Static method item (preferred — has URI + range for navigation).
    //  2. Dynamic method item — only for methods that look like real tests:
    //     parameterized instances (contain `[` or `(`), @TestFactory repeated invocations,
    //     or methods on classes that weren't statically scanned (e.g. concrete subclasses).
    //  3. Class item — fallback for class-level/setup errors (e.g. @BeforeAll throwing).
    //     These have a synthetic name: empty, FQCN-like (contains `.`), or
    //     "initializationError". Reporting on the class avoids phantom method items.
    const staticItem = inlineBridge.findMethodItem(moduleKey, tc.className, effectiveName);
    let item: vscode.TestItem | undefined;
    if (staticItem) {
        item = staticItem;
    } else {
        const classIsKnown = inlineBridge.findClassItem(moduleKey, tc.className) !== undefined;
        const looksLikeRealMethod = effectiveName.length > 0
            && !effectiveName.includes('.')         // FQCN → class-level error
            && effectiveName !== 'initializationError';

        if (classIsKnown && !looksLikeRealMethod) {
            // Class-level / setup failure: report on the class item to avoid
            // creating a phantom method entry in the sidebar.
            item = inlineBridge.findClassItem(moduleKey, tc.className);
        } else {
            // Unknown class (concrete subclass) or parameterized/inherited method.
            item = inlineBridge.getOrCreateMethodItem(moduleKey, tc.className, effectiveName);
        }
    }

    if (!item) {
        outputChannel.appendLine(`[Results] NO ITEM: ${tc.className}#${effectiveName} (raw: ${tc.methodName})`);
        return undefined;
    }

    // Ensure item is marked as started — dynamically created items (inherited tests,
    // @TestFactory, parameterized) are not pre-started in runHandler, so VS Code
    // won't include them in the run counter unless we start them here.
    run.started(item);

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

    return item;
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

    // Set location for "Go to failure" navigation.
    // Prefer the exact range; fall back to the start of the file so that
    // dynamically-created items (e.g. @BeforeAll) still get an inline annotation.
    if (item.uri) {
        const pos = item.range ? item.range.start : new vscode.Position(0, 0);
        message.location = new vscode.Location(item.uri, pos);
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
    if (tc.status === 'error' || tc.status === 'failed') {
        if (tc.failureType || tc.failureMessage) {
            const header = tc.failureType
                ? `${tc.failureType}: ${tc.failureMessage ?? ''}`
                : (tc.failureMessage ?? '');
            run.appendOutput(`${header}\r\n`, undefined, item);
        }
        if (tc.stackTrace) {
            run.appendOutput(`${tc.stackTrace}\r\n`, undefined, item);
        }
    }
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
