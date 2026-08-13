import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findMavenModules, MavenModule } from './mavenProjectDetector';
import { scanTestFiles, TestClassInfo } from './javaTestScanner';
import { parseReportFile, SuiteResult, TestCaseResult } from './surefireParser';
import { TestTreeBuilder } from './testTreeBuilder';
import { publishResults } from './resultPublisher';
import {
    buildRerunFailedArgs,
    buildRunAllArgs,
    buildRunClassArgs,
    clearReportDirectories,
    resolveExecutable,
    runMaven,
} from './mavenRunner';
import { readSettings } from './settings';
import {
    CMD_ATTACH_TO_CLAUDE,
    CMD_ATTACH_TO_COPILOT,
    CMD_CLEAN_REPORTS,
    CMD_CLEAR_RESULTS,
    CMD_CLEAR_RESULTS_AND_HISTORY,
    CMD_COPY,
    CMD_COPY_CLASS_NAME,
    CMD_COPY_FULL_PATH,
    CMD_COPY_ITEM_MAVEN_COMMAND,
    CMD_COPY_MAVEN_COMMAND,
    CMD_COPY_METHOD_NAME,
    CMD_COPY_PACKAGE_NAME,
    CMD_COLLAPSE_ALL,
    CMD_EXPAND_ALL,
    CMD_REFRESH_TESTS,
    CMD_RERUN_FAILED,
    CMD_RUN_ALL_TESTS,
    CMD_SHOW_HISTORY,
    CMD_SORT_BY_DURATION,
    CMD_SORT_BY_DURATION_ASC,
    CMD_SORT_BY_DURATION_DESC,
    CMD_SORT_BY_LOCATION,
    CMD_SORT_BY_LOCATION_ASC,
    CMD_SORT_BY_LOCATION_DESC,
    CMD_SORT_BY_NAME,
    CMD_SORT_BY_NAME_ASC,
    CMD_SORT_BY_NAME_DESC,
    CMD_SORT_BY_STATUS,
    CMD_SORT_BY_STATUS_ASC,
    CMD_SORT_BY_STATUS_DESC,
    CMD_SHOW_LIST_VIEW,
    CMD_SHOW_TREE_VIEW,
    CONTROLLER_LABEL,
    EXTENSION_ID,
    OUTPUT_CHANNEL_NAME,
    RUN_PROFILE_LABEL,
} from './constants';
import { clearHistory, loadHistory, saveRunToHistory } from './runHistory';
import {
    buildCustomTree,
    CustomSortDirection,
    CustomSortMode,
    CustomTestNode,
    CustomTreeSnapshot,
    findRunnableClassTargets,
    ModuleClasses,
    nodePathLabel,
} from './customTestModel';
import { CUSTOM_VIEW_ID, CustomTestWebviewProvider } from './customTestWebview';

interface RunTarget {
    module: MavenModule;
    classNames: readonly string[];
    runningNodeIds?: readonly string[];
}

let outputChannel: vscode.OutputChannel;
let currentModules: MavenModule[] = [];
let modulesWithClasses: ModuleClasses[] = [];
let currentTree: CustomTreeSnapshot = emptyTree();
let activeFilterExpression = '';
let activeSortMode: CustomSortMode = 'location';
let activeSortDirection: CustomSortDirection = 'asc';
let activeViewMode: 'tree' | 'list' = 'tree';
let selectedNodeId: string | undefined;
let running = false;
let runtimeRunningNodeIds = new Set<string>();
let runtimeResultByXmlPath = new Map<string, SuiteResult>();

const resultCache = new Map<string, SuiteResult>();
const expandedIds = new Set<string>();
const lastFailedClassNames = new Set<string>();
const RESULT_CACHE_KEY = 'mavenTestExplorer.resultCache';
const EXPANDED_IDS_KEY = 'mavenTestExplorer.customExpandedIds';
const SELECTED_ID_KEY = 'mavenTestExplorer.customSelectedId';
const FILTER_KEY = 'mavenTestExplorer.customFilter';
const SORT_MODE_KEY = 'mavenTestExplorer.customSortMode';
const SORT_DIRECTION_KEY = 'mavenTestExplorer.customSortDirection';
const VIEW_MODE_KEY = 'mavenTestExplorer.customViewMode';

let provider: CustomTestWebviewProvider;
let inlineController: vscode.TestController;
let inlineTreeBuilder: TestTreeBuilder;
let inlineResultFingerprint = '';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('[Extension] Maven Test Explorer activating custom view...');

    inlineController = vscode.tests.createTestController(EXTENSION_ID, CONTROLLER_LABEL);
    inlineTreeBuilder = new TestTreeBuilder(inlineController);
    context.subscriptions.push(inlineController);
    inlineController.createRunProfile(
        RUN_PROFILE_LABEL,
        vscode.TestRunProfileKind.Run,
        async (request) => runInlineRequest(context, request),
        true,
    );

    activeFilterExpression = context.workspaceState.get<string>(FILTER_KEY, '');
    activeSortMode = context.workspaceState.get<CustomSortMode>(SORT_MODE_KEY, 'location');
    activeSortDirection = context.workspaceState.get<CustomSortDirection>(SORT_DIRECTION_KEY, 'asc');
    activeViewMode = context.workspaceState.get<'tree' | 'list'>(VIEW_MODE_KEY, 'tree');
    selectedNodeId = context.workspaceState.get<string>(SELECTED_ID_KEY);
    for (const id of context.workspaceState.get<string[]>(EXPANDED_IDS_KEY, [])) {
        expandedIds.add(id);
    }

    provider = new CustomTestWebviewProvider(context.extensionUri, {
        refresh: () => refresh(context, true),
        runAll: () => runAll(context),
        rerunFailed: () => rerunFailed(context),
        clearResults: () => clearResults(context, false),
        clearResultsAndHistory: () => clearResults(context, true),
        showHistory: () => showHistory(context),
        applyFilter: (value) => applyFilter(context, value),
        clearFilter: () => applyFilter(context, ''),
        openNode: (id) => openNode(id),
        runNode: (id) => runNode(context, id),
        runNodes: (ids) => runNodes(context, ids),
        selectNode: (id) => selectNode(context, id),
        setExpanded: (id, expanded) => setExpanded(context, id, expanded),
        copy: (kind, id) => copyNode(kind, id),
        attach: (kind, id) => attachNode(kind, id),
    });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(CUSTOM_VIEW_ID, provider));

    registerCommands(context);
    registerJavaAutoRefresh(context);
    registerReportWatcher(context);

    currentModules = await discoverModules();
    if (currentModules.length === 0) {
        vscode.window.showInformationMessage('Maven Test Explorer: No pom.xml detected in workspace.');
    }
    await refresh(context, false);
    outputChannel.appendLine('[Extension] Maven Test Explorer custom view activated.');
}

export function deactivate(): void {
    // VS Code disposes subscriptions automatically.
}

async function refresh(context: vscode.ExtensionContext, showMessage: boolean): Promise<void> {
    const settings = readSettings();
    restoreResultCacheIfNeeded(context);
    currentModules = await discoverModules();
    modulesWithClasses = [];
    for (const module of currentModules) {
        const classes = await scanTestFiles(module.moduleDir, settings.testSourceGlobs);
        modulesWithClasses.push({ module, classes });
        outputChannel.appendLine(`[Discovery] ${module.artifactId}: ${classes.length} test class(es)`);
    }
    inlineTreeBuilder.buildTree(modulesWithClasses);
    inlineResultFingerprint = '';
    rebuildTree();
    if (showMessage) {
        vscode.window.showInformationMessage('Maven Test Explorer: Test tree refreshed.');
    }
}

function rebuildTree(): void {
    currentTree = buildCustomTree(
        modulesWithClasses,
        Array.from(resultCache.values()),
        activeFilterExpression,
        {
            runningNodeIds: runtimeRunningNodeIds,
            suiteResults: Array.from(runtimeResultByXmlPath.values()),
            sortMode: activeSortMode,
            sortDirection: activeSortDirection,
        },
    );
    if (!selectedNodeId || !currentTree.nodesById.has(selectedNodeId)) {
        selectedNodeId = undefined;
    }
    provider?.updateState({
        roots: currentTree.filteredRoots,
        availableTags: collectProjectTags(currentTree.roots),
        availableAnnotations: collectProjectAnnotations(currentTree.roots),
        filterFacets: collectFilterFacets(currentTree.roots),
        stats: currentTree.stats,
        filterText: activeFilterExpression,
        filterError: currentTree.filterError,
        expandedIds: Array.from(expandedIds),
        selectedId: selectedNodeId,
        running,
        viewMode: activeViewMode,
        sortMode: activeSortMode,
        sortDirection: activeSortDirection,
    });
    void vscode.commands.executeCommand(
        'setContext',
        'mavenTestExplorer.hasExpandedItems',
        activeViewMode === 'list'
            ? currentTree.filteredRoots.some((root) => expandedIds.has(root.id))
            : hasVisibleExpandedItems(currentTree.filteredRoots),
    );
    void vscode.commands.executeCommand('setContext', 'mavenTestExplorer.sortMode', activeSortMode);
    void vscode.commands.executeCommand(
        'setContext',
        'mavenTestExplorer.sortState',
        `${activeSortMode}${activeSortDirection === 'asc' ? 'Asc' : 'Desc'}`,
    );
    void vscode.commands.executeCommand('setContext', 'mavenTestExplorer.viewMode', activeViewMode);
    syncInlineResults();
}

function syncInlineResults(): void {
    const results = Array.from(resultCache.values());
    const fingerprint = inlineResultsFingerprint(results);
    if (fingerprint === inlineResultFingerprint) {
        return;
    }
    inlineResultFingerprint = fingerprint;
    if (results.length > 0) {
        publishResults(inlineController, inlineTreeBuilder, results, outputChannel, undefined, true);
    }
}

function inlineResultsFingerprint(results: readonly SuiteResult[]): string {
    return JSON.stringify(results.map((suite) => [
        suite.xmlPath,
        suite.testCases.map((testCase) => [testCase.className, testCase.methodName, testCase.status, testCase.durationMs]),
    ]));
}

async function runInlineRequest(
    context: vscode.ExtensionContext,
    request: vscode.TestRunRequest,
): Promise<void> {
    const requestedIds = (request.include ?? [])
        .map((item) => customNodeIdForInlineItem(item))
        .filter((id): id is string => Boolean(id));
    if (requestedIds.length === 0) {
        await runAll(context);
    } else {
        await runNodes(context, requestedIds);
    }
}

function customNodeIdForInlineItem(item: vscode.TestItem): string | undefined {
    if (item.uri && item.range) {
        const sourcePath = path.normalize(item.uri.fsPath).toLocaleLowerCase();
        const line = item.range.start.line + 1;
        for (const node of currentTree.nodesById.values()) {
            if (node.kind === 'method'
                && node.line === line
                && node.sourcePath
                && path.normalize(node.sourcePath).toLocaleLowerCase() === sourcePath) {
                return node.id;
            }
        }
    }
    return currentTree.nodesById.has(item.id) ? item.id : undefined;
}

function hasVisibleExpandedItems(roots: readonly CustomTestNode[]): boolean {
    const visitNode = (node: CustomTestNode): boolean => {
        if (node.children.length > 0 && expandedIds.has(node.id)) {
            return true;
        }
        return node.children.some(visitNode);
    };
    return roots.some(visitNode);
}

async function runAll(context: vscode.ExtensionContext): Promise<void> {
    await runTargets(context, currentModules.map((module) => ({
        module,
        classNames: [],
        runningNodeIds: nodeIdsForModule(module),
    })), 'Run All');
}

function collectProjectTags(roots: readonly CustomTestNode[]): string[] {
    const tags = new Set<string>();
    const visitNode = (node: CustomTestNode): void => {
        for (const tag of node.tags) {
            tags.add(`${projectTagNamespace(node)}.${tag}`);
        }
        for (const child of node.children) {
            visitNode(child);
        }
    };
    for (const root of roots) {
        visitNode(root);
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

function collectProjectAnnotations(roots: readonly CustomTestNode[]): string[] {
    const annotations = new Set<string>();
    const visitNode = (node: CustomTestNode): void => {
        for (const annotation of node.sourceAnnotations) {
            annotations.add(`${projectTagNamespace(node)}.annotation.${annotation.name.toLocaleLowerCase()}`);
        }
        for (const child of node.children) {
            visitNode(child);
        }
    };
    for (const root of roots) {
        visitNode(root);
    }
    return Array.from(annotations).sort((a, b) => a.localeCompare(b));
}

function collectFilterFacets(roots: readonly CustomTestNode[]): string[][] {
    const facets: string[][] = [];
    const visitNode = (node: CustomTestNode): void => {
        const isTestCase = (node.kind === 'method' || node.kind === 'virtualMethod')
            && !node.hasVirtualInvocations;
        if (isTestCase) {
            const values = new Set<string>();
            if (node.status === 'failed' || node.status === 'error') {
                values.add('@failed');
            }
            if (node.status !== 'unknown') {
                values.add('@executed');
            }
            for (const tag of new Set(node.tags)) {
                values.add(`@${projectTagNamespace(node)}.${tag}`);
            }
            for (const annotation of node.sourceAnnotations) {
                values.add(
                    `@${projectTagNamespace(node)}.annotation.${annotation.name.toLocaleLowerCase()}=${annotation.value}`,
                );
            }
            facets.push(Array.from(values));
        }
        for (const child of node.children) {
            visitNode(child);
        }
    };
    for (const root of roots) {
        visitNode(root);
    }
    return facets;
}

function projectTagNamespace(node: CustomTestNode): string {
    return path.basename(node.moduleDir).toLocaleLowerCase();
}

async function runNode(context: vscode.ExtensionContext, id: string): Promise<void> {
    const node = currentTree.nodesById.get(id);
    if (!node) {
        return;
    }
    const module = currentModules.find((item) => item.moduleDir === node.moduleDir);
    if (!module) {
        return;
    }
    const classNames = findRunnableClassTargets(node);
    await runTargets(context, [{ module, classNames, runningNodeIds: collectSubtreeNodeIds(node) }], nodePathLabel(node));
}

async function runNodes(context: vscode.ExtensionContext, ids: readonly string[]): Promise<void> {
    const selectedIds = new Set(ids.filter((id) => currentTree.nodesById.has(id)));
    const nodes = Array.from(selectedIds)
        .map((id) => currentTree.nodesById.get(id))
        .filter((node): node is CustomTestNode => Boolean(node))
        .filter((node) => {
            let parentId = node.parentId;
            while (parentId) {
                if (selectedIds.has(parentId)) {
                    return false;
                }
                parentId = currentTree.nodesById.get(parentId)?.parentId;
            }
            return true;
        });
    if (nodes.length === 0) {
        return;
    }
    const grouped = new Map<string, { module: MavenModule; classNames: string[]; runningNodeIds: string[] }>();
    for (const node of nodes) {
        const module = currentModules.find((item) => item.moduleDir === node.moduleDir);
        if (!module) {
            continue;
        }
        const target = grouped.get(module.moduleDir) ?? { module, classNames: [], runningNodeIds: [] };
        target.classNames.push(...findRunnableClassTargets(node));
        target.runningNodeIds.push(...collectSubtreeNodeIds(node));
        grouped.set(module.moduleDir, target);
    }
    if (grouped.size > 0) {
        const targets = Array.from(grouped.values()).map((target) => ({
            ...target,
            classNames: Array.from(new Set(target.classNames)),
            runningNodeIds: Array.from(new Set(target.runningNodeIds)),
        }));
        await runTargets(context, targets, `Run ${ids.length} Tests`);
    }
}

async function rerunFailed(context: vscode.ExtensionContext): Promise<void> {
    if (lastFailedClassNames.size === 0) {
        vscode.window.showInformationMessage('Maven Test Explorer: No failed tests to re-run.');
        return;
    }
    const moduleTargets = new Map<string, { module: MavenModule; classNames: string[]; runningNodeIds: string[] }>();
    for (const className of lastFailedClassNames) {
        const module = findModuleForClass(className);
        if (!module) {
            continue;
        }
        const entry = moduleTargets.get(module.artifactId) ?? { module, classNames: [], runningNodeIds: [] };
        entry.classNames.push(simpleClassTarget(className));
        entry.runningNodeIds.push(...nodeIdsForFqcn(className));
        moduleTargets.set(module.artifactId, entry);
    }
    await runTargets(context, Array.from(moduleTargets.values()), 'Re-run Failed');
}

async function runTargets(
    context: vscode.ExtensionContext,
    targets: readonly RunTarget[],
    historyLabel: string,
): Promise<void> {
    const settings = readSettings();
    if (settings.showOutputChannel) {
        outputChannel.show(true);
    }
    running = true;
    runtimeRunningNodeIds = new Set(targets.flatMap((target) => target.runningNodeIds ?? []));
    runtimeResultByXmlPath = new Map();
    rebuildTree();

    const cancellationSource = new vscode.CancellationTokenSource();
    const allResults: SuiteResult[] = [];
    const fullRunModuleDirs = new Set<string>();
    const inlineItems = inlineItemsForTargets(targets);
    const inlineRun = inlineController.createTestRun(
        new vscode.TestRunRequest(inlineItems.length > 0 ? inlineItems : undefined),
        historyLabel,
        true,
    );
    for (const item of inlineItems) {
        inlineRun.enqueued(item);
        inlineRun.started(item);
    }

    try {
        for (const target of targets) {
            if (settings.clearReportsBeforeRun) {
                clearReportDirectories(target.module.moduleDir);
                outputChannel.appendLine(`[Runner] Cleared reports in: ${target.module.moduleDir}`);
            }

            let args: string[];
            if (target.classNames.length === 0) {
                fullRunModuleDirs.add(target.module.moduleDir);
                args = buildRunAllArgs({ ...settings, mavenExecutable: resolveExecutable(settings, target.module.moduleDir) });
            } else if (historyLabel === 'Re-run Failed') {
                args = buildRerunFailedArgs(
                    { ...settings, mavenExecutable: resolveExecutable(settings, target.module.moduleDir) },
                    target.classNames,
                );
            } else {
                args = buildRunClassArgs(
                    { ...settings, mavenExecutable: resolveExecutable(settings, target.module.moduleDir) },
                    normalizeClassTargets(target.classNames).join(','),
                );
            }

            const poller = startRuntimeReportPolling(target.module.moduleDir, settings.reportGlobs);
            try {
                const result = await runMaven(target.module.moduleDir, args, outputChannel, cancellationSource.token);
                poller.flush();
                if (!result.cancelled) {
                    const suiteResults = addSkippedResultsForLifecycleFailures(
                        readAllReports(target.module.moduleDir, settings.reportGlobs),
                        target.runningNodeIds ?? [],
                    );
                    allResults.push(...suiteResults);
                }
            } finally {
                poller.dispose();
            }
        }
    } finally {
        try {
            updateResultCache(allResults, fullRunModuleDirs);
            updateFailedClasses(Array.from(resultCache.values()));
            await saveResultCache(context);
            if (settings.runHistoryEnabled) {
                saveRunToHistory(context, allResults, historyLabel);
            }
            if (allResults.length > 0) {
                publishResults(
                    undefined,
                    inlineTreeBuilder,
                    allResults,
                    outputChannel,
                    undefined,
                    false,
                    inlineRun,
                );
                inlineTreeBuilder.updateAggregates(Array.from(resultCache.values()));
                inlineResultFingerprint = inlineResultsFingerprint(Array.from(resultCache.values()));
            }
        } finally {
            inlineRun.end();
            running = false;
            runtimeRunningNodeIds = new Set();
            runtimeResultByXmlPath = new Map();
            rebuildTree();
        }
    }
}

function addSkippedResultsForLifecycleFailures(
    suiteResults: readonly SuiteResult[],
    runningNodeIds: readonly string[],
): SuiteResult[] {
    const lifecycleFailureClasses = new Set<string>();
    const reportedMethods = new Set<string>();
    for (const suite of suiteResults) {
        for (const testCase of suite.testCases) {
            reportedMethods.add(`${testCase.className}#${testCase.methodName}`);
            if (testCase.methodName.startsWith('@')
                && (testCase.status === 'failed' || testCase.status === 'error')) {
                lifecycleFailureClasses.add(testCase.className);
            }
        }
    }
    if (lifecycleFailureClasses.size === 0) {
        return [...suiteResults];
    }

    const skippedByClass = new Map<string, TestCaseResult[]>();
    for (const id of runningNodeIds) {
        const node = currentTree.nodesById.get(id);
        if (node?.kind !== 'method' || !node.fqcn || !node.methodName) {
            continue;
        }
        const key = `${node.fqcn}#${node.methodName}`;
        if (!lifecycleFailureClasses.has(node.fqcn) || reportedMethods.has(key)) {
            continue;
        }
        const skipped = skippedByClass.get(node.fqcn) ?? [];
        skipped.push({
            className: node.fqcn,
            methodName: node.methodName,
            status: 'skipped',
            durationMs: 0,
            failureMessage: undefined,
            failureType: undefined,
            stackTrace: undefined,
            systemOut: undefined,
            systemErr: undefined,
        });
        skippedByClass.set(node.fqcn, skipped);
        reportedMethods.add(key);
    }

    return suiteResults.map((suite) => {
        const className = skippedByClass.has(suite.suiteName)
            ? suite.suiteName
            : suite.testCases[0]?.className ?? '';
        const skipped = skippedByClass.get(className);
        skippedByClass.delete(className);
        return skipped?.length
            ? { ...suite, testCases: [...suite.testCases, ...skipped] }
            : suite;
    });
}

function inlineItemsForTargets(targets: readonly RunTarget[]): vscode.TestItem[] {
    const items = new Map<string, vscode.TestItem>();
    for (const id of targets.flatMap((target) => target.runningNodeIds ?? [])) {
        const node = currentTree.nodesById.get(id);
        if (node?.kind !== 'method' || !node.fqcn || !node.methodName) {
            continue;
        }
        const item = inlineTreeBuilder.findMethodItem(node.fqcn, node.methodName);
        if (item) {
            items.set(item.id, item);
        }
    }
    return Array.from(items.values());
}

function nodeIdsForModule(module: MavenModule): string[] {
    const root = currentTree.roots.find((node) => node.moduleDir === module.moduleDir);
    return root ? collectSubtreeNodeIds(root) : [];
}

function nodeIdsForFqcn(fqcn: string): string[] {
    for (const node of currentTree.nodesById.values()) {
        if (node.kind === 'class' && node.fqcn === fqcn) {
            return collectSubtreeNodeIds(node);
        }
    }
    return [];
}

function collectSubtreeNodeIds(node: CustomTestNode): string[] {
    const ids: string[] = [];
    const visitNode = (current: CustomTestNode) => {
        ids.push(current.id);
        for (const child of current.children) {
            visitNode(child);
        }
    };
    visitNode(node);
    return ids;
}

function startRuntimeReportPolling(
    moduleDir: string,
    reportGlobs: readonly string[],
): { flush(): void; dispose(): void } {
    const seenMtimes = new Map<string, number>();
    for (const xmlPath of listReportFiles(moduleDir, reportGlobs)) {
        seenMtimes.set(xmlPath, fileMtimeMs(xmlPath));
    }

    const scan = () => {
        let changed = false;
        for (const xmlPath of listReportFiles(moduleDir, reportGlobs)) {
            const mtimeMs = fileMtimeMs(xmlPath);
            if (seenMtimes.get(xmlPath) === mtimeMs) {
                continue;
            }
            const result = parseReportFile(xmlPath);
            if (!result) {
                continue;
            }
            seenMtimes.set(xmlPath, mtimeMs);
            runtimeResultByXmlPath.set(result.xmlPath, result);
            changed = true;
        }
        if (changed) {
            rebuildTree();
        }
    };

    const timer = setInterval(scan, 350);
    return {
        flush: scan,
        dispose: () => clearInterval(timer),
    };
}

function listReportFiles(moduleDir: string, reportGlobs: readonly string[]): string[] {
    const files: string[] = [];
    for (const dir of resolveReportDirs(moduleDir, reportGlobs)) {
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.startsWith('TEST-') && entry.endsWith('.xml')) {
                files.push(path.join(dir, entry));
            }
        }
    }
    return files.sort((a, b) => a.localeCompare(b));
}

function fileMtimeMs(filePath: string): number {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch {
        return -1;
    }
}

function registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_REFRESH_TESTS, () => refresh(context, true)),
        vscode.commands.registerCommand(CMD_RUN_ALL_TESTS, () => runAll(context)),
        vscode.commands.registerCommand(CMD_EXPAND_ALL, () => setAllExpanded(context, true)),
        vscode.commands.registerCommand(CMD_COLLAPSE_ALL, () => setAllExpanded(context, false)),
        vscode.commands.registerCommand(CMD_SORT_BY_LOCATION, () => setSortMode(context, 'location')),
        vscode.commands.registerCommand(CMD_SORT_BY_LOCATION_ASC, () => setSortMode(context, 'location')),
        vscode.commands.registerCommand(CMD_SORT_BY_LOCATION_DESC, () => setSortMode(context, 'location')),
        vscode.commands.registerCommand(CMD_SORT_BY_NAME, () => setSortMode(context, 'name')),
        vscode.commands.registerCommand(CMD_SORT_BY_NAME_ASC, () => setSortMode(context, 'name')),
        vscode.commands.registerCommand(CMD_SORT_BY_NAME_DESC, () => setSortMode(context, 'name')),
        vscode.commands.registerCommand(CMD_SORT_BY_STATUS, () => setSortMode(context, 'status')),
        vscode.commands.registerCommand(CMD_SORT_BY_STATUS_ASC, () => setSortMode(context, 'status')),
        vscode.commands.registerCommand(CMD_SORT_BY_STATUS_DESC, () => setSortMode(context, 'status')),
        vscode.commands.registerCommand(CMD_SORT_BY_DURATION, () => setSortMode(context, 'duration')),
        vscode.commands.registerCommand(CMD_SORT_BY_DURATION_ASC, () => setSortMode(context, 'duration')),
        vscode.commands.registerCommand(CMD_SORT_BY_DURATION_DESC, () => setSortMode(context, 'duration')),
        vscode.commands.registerCommand(CMD_SHOW_TREE_VIEW, () => setViewMode(context, 'tree')),
        vscode.commands.registerCommand(CMD_SHOW_LIST_VIEW, () => setViewMode(context, 'list')),
        vscode.commands.registerCommand(CMD_RERUN_FAILED, () => rerunFailed(context)),
        vscode.commands.registerCommand(CMD_CLEAN_REPORTS, async () => {
            for (const module of currentModules) {
                clearReportDirectories(module.moduleDir);
            }
            vscode.window.showInformationMessage('Maven Test Explorer: Report XML files cleaned.');
        }),
        vscode.commands.registerCommand(CMD_CLEAR_RESULTS, () => clearResults(context, false)),
        vscode.commands.registerCommand(CMD_CLEAR_RESULTS_AND_HISTORY, () => clearResults(context, true)),
        vscode.commands.registerCommand(CMD_SHOW_HISTORY, () => showHistory(context)),
        vscode.commands.registerCommand(CMD_COPY, () => copyNode('path')),
        vscode.commands.registerCommand(CMD_COPY_MAVEN_COMMAND, () => copyNode('maven')),
        vscode.commands.registerCommand(CMD_COPY_ITEM_MAVEN_COMMAND, () => copyNode('maven')),
        vscode.commands.registerCommand(CMD_COPY_CLASS_NAME, () => copyNode('class')),
        vscode.commands.registerCommand(CMD_COPY_METHOD_NAME, () => copyNode('method')),
        vscode.commands.registerCommand(CMD_COPY_PACKAGE_NAME, () => copyNode('package')),
        vscode.commands.registerCommand(CMD_COPY_FULL_PATH, () => copyNode('file')),
        vscode.commands.registerCommand(CMD_ATTACH_TO_COPILOT, () => attachNode('copilot')),
        vscode.commands.registerCommand(CMD_ATTACH_TO_CLAUDE, () => attachNode('claude')),
    );
}

async function clearResults(context: vscode.ExtensionContext, withHistory: boolean): Promise<void> {
    resultCache.clear();
    lastFailedClassNames.clear();
    await context.workspaceState.update(RESULT_CACHE_KEY, undefined);
    if (withHistory) {
        clearHistory(context);
    }
    inlineTreeBuilder.buildTree(modulesWithClasses);
    inlineResultFingerprint = '';
    rebuildTree();
    vscode.window.showInformationMessage(withHistory
        ? 'Maven Test Explorer: Results and history cleared.'
        : 'Maven Test Explorer: Results cleared.');
}

async function showHistory(context: vscode.ExtensionContext): Promise<void> {
    const history = loadHistory(context);
    if (history.length === 0) {
        vscode.window.showInformationMessage('Maven Test Explorer: No run history yet.');
        return;
    }
    const selected = await vscode.window.showQuickPick(
        history.map((entry) => ({ label: entry.label, description: entry.source, entry })),
        { title: 'Maven Test Run History', placeHolder: 'Select a run to restore its results' },
    );
    if (!selected) {
        return;
    }
    resultCache.clear();
    updateResultCache(selected.entry.suiteResults, new Set());
    updateFailedClasses(selected.entry.suiteResults);
    await saveResultCache(context);
    rebuildTree();
}

async function applyFilter(context: vscode.ExtensionContext, value: string): Promise<void> {
    activeFilterExpression = value.trim();
    await context.workspaceState.update(FILTER_KEY, activeFilterExpression);
    rebuildTree();
}

async function openNode(id: string): Promise<void> {
    const requested = currentTree.nodesById.get(id);
    if (!requested) {
        return;
    }
    const anchor = requested.isVirtual && requested.virtualParentId
        ? currentTree.nodesById.get(requested.virtualParentId) ?? requested
        : requested;
    if (requested.isVirtual) {
        vscode.window.showInformationMessage('Maven Test Explorer: Virtual test, opened parent method.');
    }
    if (!anchor.sourcePath) {
        return;
    }
    const line = Math.max((anchor.line ?? 1) - 1, 0);
    const uri = vscode.Uri.file(anchor.sourcePath);
    const range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));
    const editor = await vscode.window.showTextDocument(uri, {
        selection: range,
        preserveFocus: false,
        preview: true,
    });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

async function selectNode(context: vscode.ExtensionContext, id: string): Promise<void> {
    selectedNodeId = id;
    await context.workspaceState.update(SELECTED_ID_KEY, id);
    rebuildTree();
}

async function setExpanded(context: vscode.ExtensionContext, id: string, expanded: boolean): Promise<void> {
    if (expanded) {
        expandedIds.add(id);
    } else {
        expandedIds.delete(id);
    }
    await context.workspaceState.update(EXPANDED_IDS_KEY, Array.from(expandedIds));
    rebuildTree();
}

async function setAllExpanded(context: vscode.ExtensionContext, expanded: boolean): Promise<void> {
    if (activeViewMode === 'list') {
        for (const root of currentTree.filteredRoots) {
            if (expanded) {
                expandedIds.add(root.id);
            } else {
                expandedIds.delete(root.id);
            }
        }
        await context.workspaceState.update(EXPANDED_IDS_KEY, Array.from(expandedIds));
        rebuildTree();
        return;
    }
    if (expanded) {
        const visitNode = (node: CustomTestNode): void => {
            if (node.children.length > 0) {
                expandedIds.add(node.id);
            }
            for (const child of node.children) {
                visitNode(child);
            }
        };
        for (const root of currentTree.filteredRoots) {
            visitNode(root);
        }
    } else {
        expandedIds.clear();
    }
    await context.workspaceState.update(EXPANDED_IDS_KEY, Array.from(expandedIds));
    rebuildTree();
}

async function setSortMode(context: vscode.ExtensionContext, sortMode: CustomSortMode): Promise<void> {
    if (activeSortMode === sortMode) {
        activeSortDirection = activeSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        activeSortMode = sortMode;
        activeSortDirection = sortMode === 'status' || sortMode === 'duration' ? 'desc' : 'asc';
    }
    await Promise.all([
        context.workspaceState.update(SORT_MODE_KEY, activeSortMode),
        context.workspaceState.update(SORT_DIRECTION_KEY, activeSortDirection),
    ]);
    rebuildTree();
}

async function setViewMode(
    context: vscode.ExtensionContext,
    viewMode: 'tree' | 'list',
): Promise<void> {
    activeViewMode = viewMode;
    await context.workspaceState.update(VIEW_MODE_KEY, viewMode);
    rebuildTree();
}

async function copyNode(kind: string, id = selectedNodeId): Promise<void> {
    const node = id ? currentTree.nodesById.get(id) : undefined;
    if (!node) {
        vscode.window.showInformationMessage('Maven Test Explorer: Select a test node first.');
        return;
    }
    const text = await copyTextForNode(kind, node);
    if (!text) {
        return;
    }
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(`Copied: ${text}`);
}

async function copyTextForNode(kind: string, node: CustomTestNode): Promise<string | undefined> {
    switch (kind) {
        case 'maven':
            return mavenCommandForNode(node);
        case 'class':
            return node.fqcn;
        case 'method':
            return node.methodName;
        case 'package':
            return node.packageName;
        case 'file':
            return node.sourcePath;
        case 'path':
        default:
            return nodePathLabel(node);
    }
}

async function mavenCommandForNode(node: CustomTestNode): Promise<string | undefined> {
    const module = currentModules.find((item) => item.moduleDir === node.moduleDir);
    if (!module) {
        return undefined;
    }
    const settings = readSettings();
    const executableSettings = { ...settings, mavenExecutable: resolveExecutable(settings, module.moduleDir) };
    const targets = findRunnableClassTargets(node);
    const args = targets.length === 0
        ? buildRunAllArgs(executableSettings)
        : buildRunClassArgs(executableSettings, normalizeClassTargets(targets).join(','));
    return args.join(' ');
}

async function attachNode(kind: 'copilot' | 'claude', id = selectedNodeId): Promise<void> {
    const node = id ? currentTree.nodesById.get(id) : undefined;
    if (!node?.sourcePath) {
        vscode.window.showInformationMessage('Maven Test Explorer: Select a test node with source first.');
        return;
    }
    await openNode(node.id);
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const line = Math.max((node.line ?? 1) - 1, 0);
        const range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));
        editor.selection = new vscode.Selection(range.start, range.end);
    }
    if (kind === 'copilot') {
        try { await vscode.commands.executeCommand('github.copilot.chat.attachSelection'); } catch { /* optional */ }
        try { await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus'); } catch { /* optional */ }
    } else {
        try { await vscode.commands.executeCommand('claude-vscode.insertAtMention'); } catch { /* optional */ }
        const suffix = node.line ? `#${node.line}` : '';
        await vscode.env.clipboard.writeText(`${node.sourcePath}${suffix}`);
        try { await vscode.commands.executeCommand('claude-vscode.focus'); } catch { /* optional */ }
    }
}

function registerJavaAutoRefresh(context: vscode.ExtensionContext): void {
    let refreshDebounce: NodeJS.Timeout | undefined;
    const schedule = () => {
        const settings = readSettings();
        if (!settings.autoRefreshOnSave) {
            return;
        }
        if (refreshDebounce) {
            clearTimeout(refreshDebounce);
        }
        refreshDebounce = setTimeout(() => {
            outputChannel.appendLine('[Extension] Test file change detected, refreshing custom tree...');
            void refresh(context, false);
        }, settings.autoRefreshDebounceMs);
    };
    const watcher = vscode.workspace.createFileSystemWatcher('**/src/test/java/**/*.java');
    watcher.onDidCreate(schedule);
    watcher.onDidChange(schedule);
    watcher.onDidDelete(schedule);
    context.subscriptions.push(watcher);
}

function registerReportWatcher(context: vscode.ExtensionContext): void {
    const settings = readSettings();
    if (!settings.watchReports) {
        return;
    }
    const watcher = vscode.workspace.createFileSystemWatcher('**/target/{surefire-reports,failsafe-reports}/TEST-*.xml');
    let timer: NodeJS.Timeout | undefined;
    const schedule = () => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(async () => {
            if (running) {
                return;
            }
            outputChannel.appendLine('[Watcher] Report XML change detected, refreshing results...');
            const allResults = currentModules.flatMap((module) => readAllReports(module.moduleDir, readSettings().reportGlobs));
            updateResultCache(allResults, new Set());
            updateFailedClasses(allResults);
            await saveResultCache(context);
            rebuildTree();
        }, 500);
    };
    watcher.onDidCreate(schedule);
    watcher.onDidChange(schedule);
    watcher.onDidDelete(schedule);
    context.subscriptions.push(watcher);
}

async function discoverModules(): Promise<MavenModule[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const modules: MavenModule[] = [];
    for (const folder of folders) {
        modules.push(...await findMavenModules(folder));
    }
    outputChannel.appendLine(`[Discovery] Found ${modules.length} Maven module(s)`);
    return modules;
}

function readAllReports(moduleDir: string, reportGlobs: readonly string[]): SuiteResult[] {
    const results: SuiteResult[] = [];
    for (const dir of resolveReportDirs(moduleDir, reportGlobs)) {
        let files: string[];
        try {
            files = fs.readdirSync(dir);
        } catch {
            continue;
        }
        for (const file of files) {
            if (!file.startsWith('TEST-') || !file.endsWith('.xml')) {
                continue;
            }
            const result = parseReportFile(path.join(dir, file));
            if (result) {
                results.push(result);
            }
        }
    }
    outputChannel.appendLine(`[Runner] Parsed ${results.length} XML report file(s)`);
    return results;
}

function resolveReportDirs(moduleDir: string, reportGlobs: readonly string[]): Set<string> {
    const dirs = new Set<string>();
    for (const glob of reportGlobs) {
        const stripped = glob.replace(/^\*+\//, '');
        const dir = stripped.includes('/') ? stripped.substring(0, stripped.lastIndexOf('/')) : stripped;
        dirs.add(path.join(moduleDir, dir));
    }
    return dirs;
}

function updateResultCache(newResults: readonly SuiteResult[], fullRunModuleDirs: ReadonlySet<string>): void {
    if (fullRunModuleDirs.size > 0) {
        for (const [suiteName, suite] of resultCache) {
            if ([...fullRunModuleDirs].some((dir) => suite.xmlPath.startsWith(dir + path.sep) || suite.xmlPath.startsWith(dir + '/'))) {
                resultCache.delete(suiteName);
            }
        }
    }
    for (const suite of newResults) {
        const existing = resultCache.get(suite.suiteName);
        if (!existing) {
            resultCache.set(suite.suiteName, suite);
            continue;
        }
        const cases = new Map(existing.testCases.map((tc) => [tc.methodName, tc]));
        for (const tc of suite.testCases) {
            cases.set(tc.methodName, tc);
        }
        resultCache.set(suite.suiteName, { ...suite, testCases: Array.from(cases.values()) });
    }
}

function updateFailedClasses(suiteResults: readonly SuiteResult[]): void {
    lastFailedClassNames.clear();
    for (const suite of suiteResults) {
        for (const tc of suite.testCases) {
            if (tc.status === 'failed' || tc.status === 'error') {
                lastFailedClassNames.add(tc.className);
            }
        }
    }
}

async function saveResultCache(context: vscode.ExtensionContext): Promise<void> {
    const plain: Record<string, SuiteResult> = {};
    for (const [key, value] of resultCache) {
        plain[key] = value;
    }
    await context.workspaceState.update(RESULT_CACHE_KEY, plain);
    outputChannel.appendLine(`[Cache] Saved ${resultCache.size} result(s) to workspaceState`);
}

function restoreResultCacheIfNeeded(context: vscode.ExtensionContext): void {
    if (resultCache.size > 0) {
        return;
    }
    const plain = context.workspaceState.get<Record<string, SuiteResult>>(RESULT_CACHE_KEY);
    if (plain) {
        for (const [key, value] of Object.entries(plain)) {
            resultCache.set(key, value);
        }
        updateFailedClasses(Array.from(resultCache.values()));
        outputChannel.appendLine(`[Cache] Restored ${resultCache.size} result(s) from workspaceState`);
    }
}

function findModuleForClass(fqcn: string): MavenModule | undefined {
    for (const entry of modulesWithClasses) {
        if (entry.classes.some((cls) => toFqcn(cls) === fqcn)) {
            return entry.module;
        }
    }
    return currentModules[0];
}

function toFqcn(cls: TestClassInfo): string {
    return cls.packageName ? `${cls.packageName}.${cls.className}` : cls.className;
}

function simpleClassTarget(fqcn: string): string {
    return fqcn.substring(fqcn.lastIndexOf('.') + 1);
}

function normalizeClassTargets(targets: readonly string[]): string[] {
    const grouped = new Map<string, string[]>();
    for (const target of targets) {
        if (!target.includes('#')) {
            grouped.set(target, grouped.get(target) ?? []);
            continue;
        }
        const [className, methodName] = target.split('#', 2);
        const methods = grouped.get(className) ?? [];
        methods.push(methodName);
        grouped.set(className, methods);
    }
    return Array.from(grouped.entries()).map(([className, methods]) => (
        methods.length > 0 ? `${className}#${methods.join('+')}` : className
    ));
}

function emptyTree(): CustomTreeSnapshot {
    return {
        roots: [],
        filteredRoots: [],
        nodesById: new Map(),
        stats: { passed: 0, failed: 0, error: 0, skipped: 0, total: 0 },
    };
}
