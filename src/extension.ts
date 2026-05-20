import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findMavenModules, MavenModule } from './mavenProjectDetector';
import { scanTestFiles } from './javaTestScanner';
import { TestTreeBuilder } from './testTreeBuilder';
import { parseReportFile, SuiteResult } from './surefireParser';
import { publishResults } from './resultPublisher';
import { startReportWatcher } from './reportWatcher';
import {
    runMaven,
    buildRunAllArgs,
    buildRunClassArgs,
    buildRunMethodArgs,
    buildRerunFailedArgs,
    clearReportDirectories,
    resolveExecutable,
} from './mavenRunner';
import { readSettings } from './settings';
import {
    EXTENSION_ID,
    CONTROLLER_LABEL,
    OUTPUT_CHANNEL_NAME,
    RUN_PROFILE_LABEL,
    CMD_REFRESH_TESTS,
    CMD_RUN_ALL_TESTS,
    CMD_RERUN_FAILED,
    CMD_CLEAN_REPORTS,
    CMD_COPY_MAVEN_COMMAND,
    CMD_COPY,
    CMD_COPY_ITEM_MAVEN_COMMAND,
    CMD_COPY_CLASS_NAME,
    CMD_COPY_METHOD_NAME,
    CMD_COPY_PACKAGE_NAME,
    CMD_COPY_FULL_PATH,
    CMD_CLEAR_RESULTS,
    CMD_CLEAR_RESULTS_AND_HISTORY,
    CMD_SHOW_HISTORY,
    CMD_ATTACH_TO_COPILOT,
    CMD_ATTACH_TO_CLAUDE,
} from './constants';
import { saveRunToHistory, loadHistory, clearHistory } from './runHistory';
import { registerUiRunXmlPaths, clearUiRunXmlPaths } from './reportWatcher';

// Tracks failed class names across runs for the "Re-run Failed" command
let lastFailedClassNames: string[] = [];
// Current set of Maven modules — updated on every refresh
let currentModules: MavenModule[] = [];
let _diagChannel: vscode.OutputChannel | undefined;
// Cache of the last known SuiteResult per class name — used to compute full
// aggregates after partial runs without losing results from other classes.
// Key: suiteName (FQCN), Value: SuiteResult with merged test cases.
const resultCache = new Map<string, SuiteResult>();

/**
 * Updates the result cache with new SuiteResults.
 * For full-module runs, first evicts all suites belonging to that module.
 * For all runs, merges at method level — existing methods are updated in-place,
 * new methods are added, and methods not in the new result are preserved.
 * This ensures aggregate counts never grow beyond unique method count.
 */
function updateResultCache(newResults: readonly SuiteResult[], fullRunModuleDirs: ReadonlySet<string>): void {
    const log = (msg: string) => _diagChannel?.appendLine(`[Cache] ${msg}`);
    const totalBefore = Array.from(resultCache.values()).reduce((s, r) => s + r.testCases.length, 0);
    log(`updateResultCache — before: ${resultCache.size} suites, ${totalBefore} methods; incoming: ${newResults.length} suites; fullRunDirs: [${Array.from(fullRunModuleDirs).join(', ')}]`);

    // For full runs: evict all cached suites under those module dirs
    if (fullRunModuleDirs.size > 0) {
        for (const [suiteName, suite] of resultCache) {
            for (const dir of fullRunModuleDirs) {
                if (suite.xmlPath.startsWith(dir + path.sep) || suite.xmlPath.startsWith(dir + '/')) {
                    log(`  evict ${suiteName}`);
                    resultCache.delete(suiteName);
                    break;
                }
            }
        }
    }
    // Merge at method level: update existing methods, add new ones, preserve untouched
    for (const suite of newResults) {
        const existing = resultCache.get(suite.suiteName);
        if (!existing) {
            log(`  NEW suite "${suite.suiteName}" (${suite.testCases.length} methods)`);
            resultCache.set(suite.suiteName, suite);
        } else {
            const methodMap = new Map(existing.testCases.map(tc => [tc.methodName, tc]));
            const before = methodMap.size;
            for (const tc of suite.testCases) {
                if (!methodMap.has(tc.methodName)) {
                    log(`  NEW method "${tc.methodName}" added to "${suite.suiteName}"`);
                }
                methodMap.set(tc.methodName, tc);
            }
            const after = methodMap.size;
            if (after !== before) {
                log(`  WARN suite "${suite.suiteName}" grew ${before} → ${after}`);
            }
            resultCache.set(suite.suiteName, { ...suite, testCases: Array.from(methodMap.values()) });
        }
    }
    const totalAfter = Array.from(resultCache.values()).reduce((s, r) => s + r.testCases.length, 0);
    log(`updateResultCache — after: ${resultCache.size} suites, ${totalAfter} methods`);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    _diagChannel = outputChannel;
    context.subscriptions.push(outputChannel);

    outputChannel.appendLine('[Extension] Maven Test Explorer Bridge activating...');

    const controller = vscode.tests.createTestController(EXTENSION_ID, CONTROLLER_LABEL);
    context.subscriptions.push(controller);

    const treeBuilder = new TestTreeBuilder(controller);

    // Initial discovery
    currentModules = await discoverModules(outputChannel);
    if (currentModules.length === 0) {
        outputChannel.appendLine('[Extension] No Maven modules found. Extension idle.');
        vscode.window.showInformationMessage('Maven Test Explorer: No pom.xml detected in workspace.');
        return;
    }

    await buildTree(controller, treeBuilder, currentModules, outputChannel, context);

    // Auto-refresh when Java test files are added, removed, or renamed
    let refreshDebounce: NodeJS.Timeout | undefined;
    const scheduleAutoRefresh = () => {
        const currentSettings = readSettings();
        if (!currentSettings.autoRefreshOnSave) {
            return;
        }
        if (refreshDebounce) {
            clearTimeout(refreshDebounce);
        }
        refreshDebounce = setTimeout(async () => {
            outputChannel.appendLine('[Extension] Test file change detected — refreshing tree...');
            currentModules = await discoverModules(outputChannel);
            await buildTree(controller, treeBuilder, currentModules, outputChannel, context);
        }, currentSettings.autoRefreshDebounceMs);
    };
    const javaTestWatcher = vscode.workspace.createFileSystemWatcher('**/src/test/java/**/*.java');
    javaTestWatcher.onDidCreate(scheduleAutoRefresh);
    javaTestWatcher.onDidChange(scheduleAutoRefresh);
    javaTestWatcher.onDidDelete(scheduleAutoRefresh);
    context.subscriptions.push(javaTestWatcher);

    // resolveHandler: called lazily when VS Code expands a subtree
    controller.resolveHandler = async (item) => {
        if (item === undefined) {
            // Full refresh requested
            currentModules = await discoverModules(outputChannel);
            await buildTree(controller, treeBuilder, currentModules, outputChannel, context);
        }
    };

    // refreshHandler: triggers the reload button that VS Code shows in the Testing sidebar
    controller.refreshHandler = async (_token) => {
        outputChannel.appendLine('[Extension] Reloading test tree...');
        currentModules = await discoverModules(outputChannel);
        await buildTree(controller, treeBuilder, currentModules, outputChannel, context);
    };

    // Run profile — the only active profile for MVP
    controller.createRunProfile(
        RUN_PROFILE_LABEL,
        vscode.TestRunProfileKind.Run,
        async (request, token) => {
            await runHandler(request, token, controller, treeBuilder, currentModules, outputChannel, context);
        },
        true,
    );

    // Start file watcher for external Maven runs
    startReportWatcher(controller, treeBuilder, outputChannel, context);

    // Register commands
    registerCommands(context, controller, treeBuilder, outputChannel);

    outputChannel.appendLine('[Extension] Maven Test Explorer Bridge activated.');
}

export function deactivate(): void {
    // Subscriptions are disposed automatically by VS Code via context.subscriptions
}

// -------------------------------------------------------------------------
// Run handler
// -------------------------------------------------------------------------

async function runHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    controller: vscode.TestController,
    treeBuilder: TestTreeBuilder,
    modules: readonly MavenModule[],
    outputChannel: vscode.OutputChannel,
    context: vscode.ExtensionContext,
): Promise<void> {
    const settings = readSettings();

    if (settings.showOutputChannel) {
        outputChannel.show(true);
    }

    // Determine which modules and classes are targeted
    const targetModules = resolveTargetModules(request, treeBuilder, modules);
    const allSuiteResults: SuiteResult[] = [];
    // Modules where ALL tests were run — their cache entries must be replaced, not merged
    const fullRunModuleDirs = new Set<string>();

    // Create the TestRun upfront so we can show enqueued/started states
    const run = controller.createTestRun(request, 'Maven Surefire Results', true);

    // Recursively collect leaf (method) items from a TestItem subtree
    const collectLeaves = (item: vscode.TestItem): vscode.TestItem[] => {
        if (item.children.size === 0) {
            return [item];
        }
        const leaves: vscode.TestItem[] = [];
        item.children.forEach((child) => leaves.push(...collectLeaves(child)));
        return leaves;
    };

    // Enqueue everything that will run
    const allLeaves = request.include
        ? request.include.flatMap(collectLeaves)
        : treeBuilder.getAllMethodItems();
    for (const item of allLeaves) {
        run.enqueued(item);
    }

    try {
        for (const { module, classNames } of targetModules) {
            if (token.isCancellationRequested) {
                break;
            }

            // Mark this module's items as started (spinning indicator)
            const moduleLeaves = request.include
                ? request.include
                    .filter((item) => item.id === module.artifactId || item.id.startsWith(`${module.artifactId}/`))
                    .flatMap(collectLeaves)
                : treeBuilder.getMethodItemsForModule(module.artifactId);
            outputChannel.appendLine(`[Runner] Pre-starting ${moduleLeaves.length} static items`);
            for (const item of moduleLeaves) {
                run.started(item);
            }

            if (settings.clearReportsBeforeRun) {
                clearReportDirectories(module.moduleDir);
                outputChannel.appendLine(`[Runner] Cleared reports in: ${module.moduleDir}`);
            }

            let args: string[];
            if (classNames.length === 0) {
                fullRunModuleDirs.add(module.moduleDir);
                args = buildRunAllArgs({ ...settings, mavenExecutable: resolveExecutable(settings, module.moduleDir) });
            } else {
                // Group method-level targets by class: "ClassName#method1+method2"
                // Plain class names (no #) are passed as-is.
                const classMethodMap = new Map<string, string[]>();
                for (const segment of classNames) {
                    if (segment.includes('#')) {
                        const [cls, method] = segment.split('#', 2);
                        if (!classMethodMap.has(cls)) { classMethodMap.set(cls, []); }
                        classMethodMap.get(cls)!.push(method);
                    } else {
                        // Class-level target — no method filter
                        if (!classMethodMap.has(segment)) { classMethodMap.set(segment, []); }
                    }
                }
                const testParam = Array.from(classMethodMap.entries())
                    .map(([cls, methods]) => methods.length > 0 ? `${cls}#${methods.join('+')}` : cls)
                    .join(',');
                args = buildRunClassArgs({ ...settings, mavenExecutable: resolveExecutable(settings, module.moduleDir) }, testParam);
            }

            // Start watching report dirs — publishes results in real time as XMLs appear
            const { stop: stopWatch, claimedXmlPaths } = watchReportDirsForRun(
                module.moduleDir, settings.reportGlobs, run, treeBuilder, outputChannel,
            );

            const result = await runMaven(module.moduleDir, args, outputChannel, token, moduleLeaves.length);

            // Stop the watcher; any in-flight 150ms parse timers become irrelevant — we
            // republish everything below from readAllReports as the single source of truth.
            stopWatch();

            if (!result.cancelled) {
                // Republish ALL report files to the run.
                const allAfter = readAllReports(module.moduleDir, settings.reportGlobs, outputChannel);
                const resolvedIds = new Set<string>();
                // Shared map across all XML files: prevents double-counting parent-class
                // tests that Surefire duplicates into each nested-class XML file.
                const sharedInvocationCounts = new Map<string, number>();
                let totalTcCount = 0;
                let totalPassed = 0, totalFailed = 0, totalError = 0, totalSkipped = 0;
                for (const r of allAfter) {
                    totalTcCount += r.testCases.length;
                    for (const tc of r.testCases) {
                        switch (tc.status) {
                            case 'passed':  totalPassed++;  break;
                            case 'failed':  totalFailed++;  break;
                            case 'error':   totalError++;   break;
                            case 'skipped': totalSkipped++; break;
                        }
                    }
                    const ids = publishResults(undefined, treeBuilder, [r], outputChannel, undefined, false, run, sharedInvocationCounts);
                    ids.forEach((id) => resolvedIds.add(id));
                }
                outputChannel.appendLine(`[Runner] Total testcases in XML: ${totalTcCount}, resolved items: ${resolvedIds.size}`);
                const counted = totalPassed + totalFailed + totalError;
                const pct = counted > 0 ? ((totalPassed / counted) * 100).toFixed(1) : '0.0';
                const skippedNote = totalSkipped > 0 ? `, ${totalSkipped} skipped` : '';
                const summary = `\r\n✔ ${totalPassed}  ✘ ${totalFailed + totalError}  ⊘ ${totalSkipped}  │  ${totalPassed}/${counted} passed` +
                    (totalSkipped > 0 ? `  (${totalSkipped} skipped not counted)` : '') + `\r\n`;
                run.appendOutput(summary);
                outputChannel.appendLine(`[Results] Summary: ${totalPassed}/${counted} tests passed (${pct}%${skippedNote})`);
                registerUiRunXmlPaths(allAfter.map((r) => r.xmlPath));
                lastFailedClassNames = collectFailedClasses(allAfter);
                allSuiteResults.push(...allAfter);
            } else {
                // Cancelled — suppress external watcher for anything seen so far
                registerUiRunXmlPaths(Array.from(claimedXmlPaths));
            }
        }
    } finally {
        updateResultCache(allSuiteResults, fullRunModuleDirs);
        await saveResultCache(context, resultCache, outputChannel);
        treeBuilder.updateAggregates(Array.from(resultCache.values()));
        run.end();
        clearUiRunXmlPaths();
    }

    if (settings.runHistoryEnabled) {
        saveRunToHistory(context, allSuiteResults, 'UI Run');
    }
}

// -------------------------------------------------------------------------
// Commands
// -------------------------------------------------------------------------

/** Opens a TestItem's source file in a preview editor and resolves its line range.
 *  For method items the range comes directly from item.range.
 *  For class items (no range set) the range is looked up via DocumentSymbolProvider. */
async function openItemInEditor(item: vscode.TestItem): Promise<{ editor: vscode.TextEditor; range: vscode.Range | undefined }> {
    const editor = await vscode.window.showTextDocument(item.uri!, {
        selection: item.range,
        preserveFocus: false,
        preview: true,
    });
    let range = item.range;
    if (!range) {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider', item.uri!,
        );
        if (symbols) {
            const parts = item.id.split('/');
            const simpleName = parts[parts.length - 1].split('$').pop() ?? '';
            const find = (list: vscode.DocumentSymbol[]): vscode.DocumentSymbol | undefined => {
                for (const s of list) {
                    if (s.kind === vscode.SymbolKind.Class && s.name === simpleName) { return s; }
                    const found = find(s.children);
                    if (found) { return found; }
                }
                return undefined;
            };
            range = find(symbols)?.range;
        }
    }
    return { editor, range };
}

function registerCommands(
    context: vscode.ExtensionContext,
    controller: vscode.TestController,
    treeBuilder: TestTreeBuilder,
    outputChannel: vscode.OutputChannel,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_REFRESH_TESTS, async () => {
            outputChannel.appendLine('[Command] Refreshing test tree...');
            currentModules = await discoverModules(outputChannel);
            await buildTree(controller, treeBuilder, currentModules, outputChannel, context);
            vscode.window.showInformationMessage('Maven Test Explorer: Test tree refreshed.');
        }),

        vscode.commands.registerCommand(CMD_RUN_ALL_TESTS, async () => {
            const settings = readSettings();
            if (settings.showOutputChannel) {
                outputChannel.show(true);
            }
            const token = new vscode.CancellationTokenSource().token;
            const allRunAllResults: SuiteResult[] = [];
            for (const module of currentModules) {
                if (settings.clearReportsBeforeRun) {
                    clearReportDirectories(module.moduleDir);
                }
                const args = buildRunAllArgs({ ...settings, mavenExecutable: resolveExecutable(settings, module.moduleDir) });
                const result = await runMaven(module.moduleDir, args, outputChannel, token);
                if (!result.cancelled) {
                    const suiteResults = readAllReports(module.moduleDir, settings.reportGlobs, outputChannel);
                    publishResults(controller, treeBuilder, suiteResults, outputChannel, undefined);
                    lastFailedClassNames = collectFailedClasses(suiteResults);
                    allRunAllResults.push(...suiteResults);
                }
            }
            if (settings.runHistoryEnabled) {
                saveRunToHistory(context, allRunAllResults, 'Run All');
            }
        }),

        vscode.commands.registerCommand(CMD_RERUN_FAILED, async () => {
            if (lastFailedClassNames.length === 0) {
                vscode.window.showInformationMessage('Maven Test Explorer: No failed tests to re-run.');
                return;
            }
            const settings = readSettings();
            if (settings.showOutputChannel) {
                outputChannel.show(true);
            }
            const token = new vscode.CancellationTokenSource().token;
            const allRerunResults: SuiteResult[] = [];
            for (const module of currentModules) {
                const args = buildRerunFailedArgs({ ...settings, mavenExecutable: resolveExecutable(settings, module.moduleDir) }, lastFailedClassNames);
                const result = await runMaven(module.moduleDir, args, outputChannel, token);
                if (!result.cancelled) {
                    const suiteResults = readAllReports(module.moduleDir, settings.reportGlobs, outputChannel);
                    publishResults(controller, treeBuilder, suiteResults, outputChannel, undefined);
                    lastFailedClassNames = collectFailedClasses(suiteResults);
                    allRerunResults.push(...suiteResults);
                }
            }
            if (settings.runHistoryEnabled) {
                saveRunToHistory(context, allRerunResults, 'Rerun Failed');
            }
        }),

        vscode.commands.registerCommand(CMD_CLEAN_REPORTS, () => {
            for (const module of currentModules) {
                clearReportDirectories(module.moduleDir);
                outputChannel.appendLine(`[Command] Cleaned reports: ${module.moduleDir}`);
            }
            vscode.window.showInformationMessage('Maven Test Explorer: Test reports cleaned.');
        }),

        vscode.commands.registerCommand(CMD_COPY_MAVEN_COMMAND, async () => {
            const settings = readSettings();
            const resolvedExecutable = currentModules.length > 0
                ? resolveExecutable(settings, currentModules[0].moduleDir)
                : settings.mavenExecutable;
            const effectiveSettings = { ...settings, mavenExecutable: resolvedExecutable };
            const args = lastFailedClassNames.length > 0
                ? buildRerunFailedArgs(effectiveSettings, lastFailedClassNames)
                : buildRunAllArgs(effectiveSettings);
            const command = args.join(' ');
            await vscode.env.clipboard.writeText(command);
            vscode.window.showInformationMessage(`Copied: ${command}`);
        }),

        // Context menu: "Copy..." — opens QuickPick, receives selected items directly (bypasses submenu limitation)
        vscode.commands.registerCommand(CMD_COPY, async (item: vscode.TestItem, ...rest: vscode.TestItem[]) => {
            if (!item) { return; }
            const items: vscode.TestItem[] = [item, ...rest];
            const hasMethods = items.some((i) => i.id.includes('#'));
            const hasSlash = items.some((i) => i.id.includes('/'));
            const hasClass = items.some((i) => i.id.split('/').length >= 3);
            type CopyOption = vscode.QuickPickItem & { action: string };
            const options: CopyOption[] = [
                { label: '$(terminal) Copy Maven Command', action: 'maven' },
                ...(hasSlash ? [{ label: '$(symbol-namespace) Copy Package Name', action: 'package' }] : []),
                ...(hasClass ? [{ label: '$(symbol-class) Copy Class Name (FQCN)', action: 'class' }] : []),
                ...(hasSlash ? [{ label: '$(symbol-reference) Copy Full Path', action: 'fullpath' }] : []),
                ...(hasMethods ? [{ label: '$(symbol-method) Copy Method Name', action: 'method' }] : []),
            ];
            const picked = await vscode.window.showQuickPick(options, {
                placeHolder: items.length > 1 ? `Copy — ${items.length} items selected` : `Copy — ${item.label}`,
            }) as CopyOption | undefined;
            if (!picked) { return; }

            if (picked.action === 'maven') {
                const settings = readSettings();
                const moduleMap = new Map<string, { module: MavenModule; classNames: string[] }>();
                for (const it of items) {
                    const parts = it.id.split('/');
                    const mod = currentModules.find((m) => m.artifactId === parts[0]);
                    if (!mod) { continue; }
                    if (!moduleMap.has(parts[0])) { moduleMap.set(parts[0], { module: mod, classNames: [] }); }
                    const entry = moduleMap.get(parts[0])!;
                    if (parts.length === 2) {
                        treeBuilder.getFqcnsForPackage(parts[0], parts[1]).forEach((f) => entry.classNames.push(f.substring(f.lastIndexOf('.') + 1)));
                    } else if (parts.length >= 3) {
                        entry.classNames.push(parts[2]);
                    }
                }
                const commands: string[] = [];
                for (const { module: mod, classNames } of moduleMap.values()) {
                    const effectiveSettings = { ...settings, mavenExecutable: resolveExecutable(settings, mod.moduleDir) };
                    let args: string[];
                    if (classNames.length === 0) {
                        args = buildRunAllArgs(effectiveSettings);
                    } else {
                        const classMethodMap = new Map<string, string[]>();
                        for (const seg of classNames) {
                            if (seg.includes('#')) {
                                const [cls, method] = seg.split('#', 2);
                                if (!classMethodMap.has(cls)) { classMethodMap.set(cls, []); }
                                classMethodMap.get(cls)!.push(method);
                            } else {
                                if (!classMethodMap.has(seg)) { classMethodMap.set(seg, []); }
                            }
                        }
                        const testParam = Array.from(classMethodMap.entries())
                            .map(([cls, methods]) => methods.length > 0 ? `${cls}#${methods.join('+')}` : cls)
                            .join(',');
                        args = buildRunClassArgs(effectiveSettings, testParam);
                    }
                    commands.push(args.join(' '));
                }
                const text = commands.join('\n');
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage(commands.length > 1 ? `Copied ${commands.length} commands` : `Copied: ${text}`);

            } else if (picked.action === 'package') {
                const packages = [...new Set(items.map((it) => { const p = it.id.split('/'); return p.length >= 2 ? p[1] : p[0]; }))];
                const text = packages.join('\n');
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage(packages.length > 1 ? `Copied ${packages.length} package names` : `Copied: ${text}`);

            } else if (picked.action === 'class') {
                const fqcns = [...new Set(items.map((it) => {
                    const p = it.id.split('/');
                    if (p.length >= 3) { return p[1] ? `${p[1]}.${p[2].split('#')[0]}` : p[2].split('#')[0]; }
                    if (p.length === 2) { return p[1]; }
                    return null;
                }).filter(Boolean) as string[])];
                if (fqcns.length === 0) { return; }
                const text = fqcns.join('\n');
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage(fqcns.length > 1 ? `Copied ${fqcns.length} class names` : `Copied: ${text}`);

            } else if (picked.action === 'fullpath') {
                const paths = items.map((it) => {
                    const p = it.id.split('/');
                    if (p.length === 1) { return p[0]; }
                    if (p.length === 2) { return p[1]; }
                    return p[1] ? `${p[1]}.${p[2]}` : p[2];
                });
                const text = paths.join('\n');
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage(paths.length > 1 ? `Copied ${paths.length} paths` : `Copied: ${text}`);

            } else if (picked.action === 'method') {
                const methods = [...new Set(items.map((it) => {
                    const p = it.id.split('/');
                    if (p.length < 3) { return null; }
                    const h = p[2].indexOf('#');
                    return h >= 0 ? p[2].substring(h + 1) : null;
                }).filter(Boolean) as string[])];
                if (methods.length === 0) { return; }
                const text = methods.join('\n');
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage(methods.length > 1 ? `Copied ${methods.length} method names` : `Copied: ${text}`);
            }
        }),

        // Context menu: Copy Maven command for a specific test item (multi-select aware)
        vscode.commands.registerCommand(CMD_COPY_ITEM_MAVEN_COMMAND, async (item: vscode.TestItem, selected?: readonly vscode.TestItem[]) => {
            if (!item) { return; }
            const items = selected && selected.length > 0 ? selected : [item];
            const settings = readSettings();
            // Group by module
            const moduleMap = new Map<string, { module: MavenModule; classNames: string[] }>();
            for (const it of items) {
                const parts = it.id.split('/');
                const moduleArtifactId = parts[0];
                const mod = currentModules.find((m) => m.artifactId === moduleArtifactId);
                if (!mod) { continue; }
                if (!moduleMap.has(moduleArtifactId)) { moduleMap.set(moduleArtifactId, { module: mod, classNames: [] }); }
                const entry = moduleMap.get(moduleArtifactId)!;
                if (parts.length === 2) {
                    const fqcns = treeBuilder.getFqcnsForPackage(moduleArtifactId, parts[1]);
                    fqcns.forEach((f) => entry.classNames.push(f.substring(f.lastIndexOf('.') + 1)));
                } else if (parts.length >= 3) {
                    entry.classNames.push(parts[2]);
                }
            }
            const commands: string[] = [];
            for (const { module: mod, classNames } of moduleMap.values()) {
                const resolvedExecutable = resolveExecutable(settings, mod.moduleDir);
                const effectiveSettings = { ...settings, mavenExecutable: resolvedExecutable };
                let args: string[];
                if (classNames.length === 0) {
                    args = buildRunAllArgs(effectiveSettings);
                } else {
                    // Group methods by class
                    const classMethodMap = new Map<string, string[]>();
                    for (const seg of classNames) {
                        if (seg.includes('#')) {
                            const [cls, method] = seg.split('#', 2);
                            if (!classMethodMap.has(cls)) { classMethodMap.set(cls, []); }
                            classMethodMap.get(cls)!.push(method);
                        } else {
                            if (!classMethodMap.has(seg)) { classMethodMap.set(seg, []); }
                        }
                    }
                    const testParam = Array.from(classMethodMap.entries())
                        .map(([cls, methods]) => methods.length > 0 ? `${cls}#${methods.join('+')}` : cls)
                        .join(',');
                    args = buildRunClassArgs(effectiveSettings, testParam);
                }
                commands.push(args.join(' '));
            }
            const command = commands.join('\n');
            await vscode.env.clipboard.writeText(command);
            vscode.window.showInformationMessage(items.length > 1 ? `Copied ${items.length} commands` : `Copied: ${command}`);
        }),

        // Context menu: Copy class name (FQCN) — multi-select aware
        vscode.commands.registerCommand(CMD_COPY_CLASS_NAME, async (item: vscode.TestItem, selected?: readonly vscode.TestItem[]) => {
            if (!item) { return; }
            const items = selected && selected.length > 0 ? selected : [item];
            const fqcns = [...new Set(items.map((it) => {
                const parts = it.id.split('/');
                if (parts.length >= 3) {
                    const pkg = parts[1]; const cls = parts[2].split('#')[0];
                    return pkg ? `${pkg}.${cls}` : cls;
                } else if (parts.length === 2) { return parts[1]; }
                return null;
            }).filter(Boolean) as string[])];
            if (fqcns.length === 0) { return; }
            const text = fqcns.join('\n');
            await vscode.env.clipboard.writeText(text);
            vscode.window.showInformationMessage(fqcns.length > 1 ? `Copied ${fqcns.length} class names` : `Copied: ${text}`);
        }),

        // Context menu: Copy method name only — multi-select aware
        vscode.commands.registerCommand(CMD_COPY_METHOD_NAME, async (item: vscode.TestItem, selected?: readonly vscode.TestItem[]) => {
            if (!item) { return; }
            const items = selected && selected.length > 0 ? selected : [item];
            const methods = [...new Set(items.map((it) => {
                const parts = it.id.split('/');
                if (parts.length < 3) { return null; }
                const hashIdx = parts[2].indexOf('#');
                return hashIdx >= 0 ? parts[2].substring(hashIdx + 1) : null;
            }).filter(Boolean) as string[])];
            if (methods.length === 0) { return; }
            const text = methods.join('\n');
            await vscode.env.clipboard.writeText(text);
            vscode.window.showInformationMessage(methods.length > 1 ? `Copied ${methods.length} method names` : `Copied: ${text}`);
        }),

        // Context menu: Copy package name — multi-select aware
        vscode.commands.registerCommand(CMD_COPY_PACKAGE_NAME, async (item: vscode.TestItem, selected?: readonly vscode.TestItem[]) => {
            if (!item) { return; }
            const items = selected && selected.length > 0 ? selected : [item];
            const packages = [...new Set(items.map((it) => {
                const parts = it.id.split('/');
                return parts.length >= 2 ? parts[1] : parts[0];
            }))];
            const text = packages.join('\n');
            await vscode.env.clipboard.writeText(text);
            vscode.window.showInformationMessage(packages.length > 1 ? `Copied ${packages.length} package names` : `Copied: ${text}`);
        }),

        // Context menu: Copy full path — multi-select aware
        vscode.commands.registerCommand(CMD_COPY_FULL_PATH, async (item: vscode.TestItem, selected?: readonly vscode.TestItem[]) => {
            if (!item) { return; }
            const items = selected && selected.length > 0 ? selected : [item];
            const paths = items.map((it) => {
                const parts = it.id.split('/');
                if (parts.length === 1) { return parts[0]; }
                if (parts.length === 2) { return parts[1]; }
                const pkg = parts[1]; const classAndMethod = parts[2];
                return pkg ? `${pkg}.${classAndMethod}` : classAndMethod;
            });
            const text = paths.join('\n');
            await vscode.env.clipboard.writeText(text);
            vscode.window.showInformationMessage(paths.length > 1 ? `Copied ${paths.length} paths` : `Copied: ${text}`);
        }),

        vscode.commands.registerCommand(CMD_CLEAR_RESULTS, async () => {
            outputChannel.appendLine('[Command] Clearing test results...');
            resultCache.clear();
            await context.workspaceState.update(RESULT_CACHE_KEY, undefined);
            currentModules = await discoverModules(outputChannel);
            await buildTree(controller, treeBuilder, currentModules, outputChannel, context, false);
            await vscode.commands.executeCommand('testing.clearTestResults');
            vscode.window.showInformationMessage('Maven Test Explorer: Results cleared.');
        }),

        vscode.commands.registerCommand(CMD_CLEAR_RESULTS_AND_HISTORY, async () => {
            outputChannel.appendLine('[Command] Clearing test results and history...');
            resultCache.clear();
            await context.workspaceState.update(RESULT_CACHE_KEY, undefined);
            clearHistory(context);
            currentModules = await discoverModules(outputChannel);
            await buildTree(controller, treeBuilder, currentModules, outputChannel, context, false);
            await vscode.commands.executeCommand('testing.clearTestResults');
            vscode.window.showInformationMessage('Maven Test Explorer: Results and history cleared.');
        }),

        vscode.commands.registerCommand(CMD_SHOW_HISTORY, async () => {
            const history = loadHistory(context);
            if (history.length === 0) {
                vscode.window.showInformationMessage('Maven Test Explorer: No run history yet.');
                return;
            }

            const items = history.map((entry) => ({
                label: entry.label,
                description: entry.source,
                entry,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                title: 'Maven Test Run History',
                placeHolder: 'Select a run to restore its results in the Testing panel',
                canPickMany: false,
            });

            if (selected) {
                outputChannel.appendLine(
                    `[History] Restoring run: ${selected.entry.label}`,
                );
                treeBuilder.resetAllResults();
                await vscode.commands.executeCommand('testing.clearTestResults');
                publishResults(
                    controller,
                    treeBuilder,
                    selected.entry.suiteResults,
                    outputChannel,
                    undefined,
                    true,
                );
            }
        }),

        // Context menu: "Attach to Copilot Chat" — opens source, selects range, attaches, closes preview
        vscode.commands.registerCommand(CMD_ATTACH_TO_COPILOT, async (item: vscode.TestItem, ...rest: vscode.TestItem[]) => {
            if (!item?.uri) { return; }
            for (const it of [item, ...rest].filter((i) => i?.uri)) {
                const { editor, range } = await openItemInEditor(it);
                if (range) {
                    editor.selection = new vscode.Selection(range.start, range.end);
                    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                }
                try { await vscode.commands.executeCommand('github.copilot.chat.attachSelection'); } catch { /* not installed */ }
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            }
            try { await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus'); } catch { /* not installed */ }
        }),

        // Context menu: "Attach to Claude" — builds file#startLine-endLine path, opens Claude, inserts reference
        vscode.commands.registerCommand(CMD_ATTACH_TO_CLAUDE, async (item: vscode.TestItem, ...rest: vscode.TestItem[]) => {
            if (!item?.uri) { return; }
            for (const it of [item, ...rest].filter((i) => i?.uri)) {
                const { editor, range } = await openItemInEditor(it);
                if (range) {
                    editor.selection = new vscode.Selection(range.start, range.end);
                    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                }
                // Try Claude's insertAtMention with active selection
                try { await vscode.commands.executeCommand('claude-vscode.insertAtMention'); } catch { /* not installed */ }
                // Also build path string for manual paste fallback
                if (range) {
                    const startLine = range.start.line + 1;
                    const endLine = range.end.line + 1;
                    const lineFragment = startLine === endLine ? `#${startLine}` : `#${startLine}-${endLine}`;
                    const pathStr = it.uri!.fsPath + lineFragment;
                    await vscode.env.clipboard.writeText(pathStr);
                }
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            }
            try { await vscode.commands.executeCommand('claude-vscode.focus'); } catch { /* not installed */ }
        }),
    );
}

// -------------------------------------------------------------------------
// Private helpers
// -------------------------------------------------------------------------

async function discoverModules(outputChannel: vscode.OutputChannel): Promise<MavenModule[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const allModules: MavenModule[] = [];

    for (const folder of folders) {
        const found = await findMavenModules(folder);
        allModules.push(...found);
    }

    outputChannel.appendLine(`[Discovery] Found ${allModules.length} Maven module(s)`);
    return allModules;
}

async function buildTree(
    controller: vscode.TestController,
    treeBuilder: TestTreeBuilder,
    modules: readonly MavenModule[],
    outputChannel: vscode.OutputChannel,
    context: vscode.ExtensionContext,
    restoreResults = true,
): Promise<void> {
    const { testSourceGlobs } = readSettings();
    const modulesWithClasses: Array<{ module: MavenModule; classes: Awaited<ReturnType<typeof scanTestFiles>> }> = [];

    for (const module of modules) {
        const classes = await scanTestFiles(module.moduleDir, testSourceGlobs);
        modulesWithClasses.push({ module, classes });
        outputChannel.appendLine(
            `[Discovery] ${module.artifactId}: ${classes.length} test class(es)`,
        );
    }

    treeBuilder.buildTree(modulesWithClasses);

    if (!restoreResults) {
        return;
    }

    // Restore aggregation: prefer persisted cache, fall back to XML files on disk
    resultCache.clear();
    const persisted = loadResultCache(context, outputChannel);
    if (persisted.size > 0) {
        for (const [k, v] of persisted) { resultCache.set(k, v); }
        outputChannel.appendLine(`[Extension] Restored ${resultCache.size} cached result(s) from workspace state`);
    } else {
        // First launch or after cache was cleared — read from disk
        const settings = readSettings();
        for (const module of modules) {
            const existing = readAllReports(module.moduleDir, settings.reportGlobs, outputChannel);
            updateResultCache(existing, new Set());
        }
    }

    // Replay cached results into a persistent TestRun to restore icons
    if (resultCache.size > 0) {
        const restoreRun = controller.createTestRun(new vscode.TestRunRequest(), 'Restored Results', true);
        publishResults(undefined, treeBuilder, Array.from(resultCache.values()), outputChannel, undefined, false, restoreRun);
        restoreRun.end();
    }

    treeBuilder.updateAggregates(Array.from(resultCache.values()));
}

/**
 * Watches the module directory recursively during a Maven run.
 * Publishes results to the open TestRun as soon as each TEST-*.xml file appears.
 * Using recursive watch on moduleDir survives Maven clean deleting/recreating target/.
 * Returns a cleanup function and the set of XML paths claimed by this watcher.
 */
function watchReportDirsForRun(
    moduleDir: string,
    reportGlobs: readonly string[],
    run: vscode.TestRun,
    treeBuilder: TestTreeBuilder,
    outputChannel: vscode.OutputChannel,
): { stop: () => void; claimedXmlPaths: Set<string> } {
    const seenFiles = new Set<string>();
    const reportDirs = resolveReportDirs(moduleDir, reportGlobs);

    // Normalise to forward-slash relative paths for comparison
    const isInReportDir = (absolutePath: string): boolean => {
        for (const dir of reportDirs) {
            if (absolutePath.startsWith(dir + path.sep) || absolutePath.startsWith(dir + '/')) {
                return true;
            }
        }
        return false;
    };

    let watcher: fs.FSWatcher | undefined;
    const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
    try {
        watcher = fs.watch(moduleDir, { recursive: true }, (_eventType, filename) => {
            if (!filename) {
                return;
            }
            const basename = path.basename(filename);
            if (!basename.startsWith('TEST-') || !basename.endsWith('.xml')) {
                return;
            }
            const xmlPath = path.join(moduleDir, filename);
            if (seenFiles.has(xmlPath)) {
                return;
            }
            if (!isInReportDir(xmlPath)) {
                return;
            }
            seenFiles.add(xmlPath);
            // Register immediately so the external FileSystemWatcher's debounce
            // finds this path already excluded when it fires ~500ms later.
            registerUiRunXmlPaths([xmlPath]);
            // Small delay — surefire may still be writing the file.
            // Real-time preview only; the final authoritative publish happens via
            // readAllReports after Maven exits, so no need to track collectedResults.
            const timer = setTimeout(() => {
                pendingTimers.delete(timer);
                const result = parseReportFile(xmlPath);
                if (result) {
                    publishResults(undefined, treeBuilder, [result], outputChannel, undefined, false, run);
                }
            }, 150);
            pendingTimers.add(timer);
        });
    } catch {
        outputChannel.appendLine(`[Runner] Cannot watch module dir: ${moduleDir}`);
    }

    return {
        stop: () => {
            watcher?.close();
            // Cancel pending parse timers so they don't fire after readAllReports
            // republishes everything — prevents double-publishing the same files.
            for (const t of pendingTimers) { clearTimeout(t); }
            pendingTimers.clear();
        },
        claimedXmlPaths: seenFiles,
    };
}

/** Extracts concrete report directory paths from glob patterns relative to moduleDir. */
function resolveReportDirs(moduleDir: string, reportGlobs: readonly string[]): Set<string> {
    const dirs = new Set<string>();
    for (const glob of reportGlobs) {
        const stripped = glob.replace(/^\*+\//, '');
        const dir = stripped.includes('/') ? stripped.substring(0, stripped.lastIndexOf('/')) : stripped;
        dirs.add(path.join(moduleDir, dir));
    }
    return dirs;
}

function readAllReports(
    moduleDir: string,
    reportGlobs: readonly string[],
    outputChannel: vscode.OutputChannel,
): SuiteResult[] {
    const results: SuiteResult[] = [];
    const nodefs = require('fs') as typeof import('fs');

    // Convert globs to concrete paths
    const resolvedDirs = resolveReportDirs(moduleDir, reportGlobs);

    for (const dir of resolvedDirs) {
        let files: string[];
        try {
            files = nodefs.readdirSync(dir);
        } catch {
            // Directory does not exist — skip silently
            continue;
        }

        for (const file of files) {
            if (file.startsWith('TEST-') && file.endsWith('.xml')) {
                const xmlPath = path.join(dir, file);
                const result = parseReportFile(xmlPath);
                if (result) {
                    results.push(result);
                } else {
                    outputChannel.appendLine(`[Runner] Failed to parse: ${xmlPath}`);
                }
            }
        }
    }

    outputChannel.appendLine(`[Runner] Parsed ${results.length} XML report file(s)`);
    return results;
}

function resolveTargetModules(
    request: vscode.TestRunRequest,
    treeBuilder: TestTreeBuilder,
    modules: readonly MavenModule[],
): Array<{ module: MavenModule; classNames: string[] }> {
    if (!request.include || request.include.length === 0) {
        // Run all modules
        return modules.map((module) => ({ module, classNames: [] }));
    }

    // Group requested items by module (first path segment of their ID)
    const moduleMap = new Map<string, { module: MavenModule; classNames: string[] }>();

    for (const item of request.include) {
        const parts = item.id.split('/');
        const moduleArtifactId = parts[0];
        const module = modules.find((m) => m.artifactId === moduleArtifactId);
        if (!module) {
            continue;
        }

        if (!moduleMap.has(moduleArtifactId)) {
            moduleMap.set(moduleArtifactId, { module, classNames: [] });
        }

        const entry = moduleMap.get(moduleArtifactId)!;

        if (parts.length === 2) {
            // Package selected — collect all root classes in that package
            const packageName = parts[1];
            const fqcns = treeBuilder.getFqcnsForPackage(moduleArtifactId, packageName);
            for (const fqcn of fqcns) {
                const simpleName = fqcn.substring(fqcn.lastIndexOf('.') + 1);
                entry.classNames.push(simpleName);
            }
        } else if (parts.length >= 3) {
            // Class or method selected
            const classSegment = parts[2]; // e.g. "CreateChannelsAdTest" or "CreateChannelsAdTest#method"
            entry.classNames.push(classSegment);
        }
        // If only module is selected (parts.length === 1), run the whole module
    }

    return Array.from(moduleMap.values());
}

function collectFailedClasses(suiteResults: readonly SuiteResult[]): string[] {
    const failed = new Set<string>();
    for (const suite of suiteResults) {
        for (const tc of suite.testCases) {
            if (tc.status === 'failed' || tc.status === 'error') {
                failed.add(tc.className);
            }
        }
    }
    return Array.from(failed);
}

// -------------------------------------------------------------------------
// Result cache persistence (workspaceState)
// -------------------------------------------------------------------------

const RESULT_CACHE_KEY = 'mavenTestExplorer.resultCache';

async function saveResultCache(context: vscode.ExtensionContext, cache: Map<string, SuiteResult>, outputChannel: vscode.OutputChannel): Promise<void> {
    const plain: Record<string, SuiteResult> = {};
    for (const [k, v] of cache) { plain[k] = v; }
    await context.workspaceState.update(RESULT_CACHE_KEY, plain);
    outputChannel.appendLine(`[Cache] Saved ${cache.size} result(s) to workspaceState`);
}

function loadResultCache(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Map<string, SuiteResult> {
    const plain = context.workspaceState.get<Record<string, SuiteResult>>(RESULT_CACHE_KEY);
    outputChannel.appendLine(`[Cache] Load attempt — raw value type: ${typeof plain}, keys: ${plain ? Object.keys(plain).length : 'null'}`);
    if (!plain) { return new Map(); }
    return new Map(Object.entries(plain));
}
