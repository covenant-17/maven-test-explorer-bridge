import * as vscode from 'vscode';
import * as path from 'path';
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
    CMD_CLEAR_RESULTS,
    CMD_SHOW_HISTORY,
} from './constants';
import { saveRunToHistory, loadHistory, clearHistory } from './runHistory';

// Tracks failed class names across runs for the "Re-run Failed" command
let lastFailedClassNames: string[] = [];
// Current set of Maven modules — updated on every refresh
let currentModules: MavenModule[] = [];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
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

    await buildTree(controller, treeBuilder, currentModules, outputChannel);

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
            await buildTree(controller, treeBuilder, currentModules, outputChannel);
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
            await buildTree(controller, treeBuilder, currentModules, outputChannel);
        }
    };

    // refreshHandler: triggers the reload button that VS Code shows in the Testing sidebar
    controller.refreshHandler = async (_token) => {
        outputChannel.appendLine('[Extension] Reloading test tree...');
        currentModules = await discoverModules(outputChannel);
        await buildTree(controller, treeBuilder, currentModules, outputChannel);
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

    for (const { module, classNames } of targetModules) {
        if (token.isCancellationRequested) {
            break;
        }

        if (settings.clearReportsBeforeRun) {
            clearReportDirectories(module.moduleDir);
            outputChannel.appendLine(`[Runner] Cleared reports in: ${module.moduleDir}`);
        }

        let args: string[];
        if (classNames.length === 0) {
            args = buildRunAllArgs({ ...settings, mavenExecutable: resolveExecutable(settings, module.moduleDir) });
        } else if (classNames.length === 1 && classNames[0].includes('#')) {
            const [className, methodName] = classNames[0].split('#');
            args = buildRunMethodArgs({ ...settings, mavenExecutable: resolveExecutable(settings, module.moduleDir) }, className, methodName);
        } else {
            args = buildRunClassArgs({ ...settings, mavenExecutable: resolveExecutable(settings, module.moduleDir) }, classNames.join('+'));
        }

        const result = await runMaven(module.moduleDir, args, outputChannel, token);

        if (!result.cancelled) {
            const suiteResults = readAllReports(module.moduleDir, settings.reportGlobs, outputChannel);
            publishResults(controller, treeBuilder, suiteResults, outputChannel, request);
            lastFailedClassNames = collectFailedClasses(suiteResults);
            allSuiteResults.push(...suiteResults);
        }
    }

    if (settings.runHistoryEnabled) {
        saveRunToHistory(context, allSuiteResults, 'UI Run');
    }
}

// -------------------------------------------------------------------------
// Commands
// -------------------------------------------------------------------------

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
            await buildTree(controller, treeBuilder, currentModules, outputChannel);
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
            const args = lastFailedClassNames.length > 0
                ? buildRerunFailedArgs(settings, lastFailedClassNames)
                : buildRunAllArgs(settings);
            const command = args.join(' ');
            await vscode.env.clipboard.writeText(command);
            vscode.window.showInformationMessage(`Copied: ${command}`);
        }),

        vscode.commands.registerCommand(CMD_CLEAR_RESULTS, async () => {
            outputChannel.appendLine('[Command] Clearing test results...');
            currentModules = await discoverModules(outputChannel);
            await buildTree(controller, treeBuilder, currentModules, outputChannel);
            treeBuilder.resetAllResults();
            await vscode.commands.executeCommand('testing.clearTestResults');
            vscode.window.showInformationMessage('Maven Test Explorer: Results cleared.');
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
}

function readAllReports(
    moduleDir: string,
    reportGlobs: readonly string[],
    outputChannel: vscode.OutputChannel,
): SuiteResult[] {
    const results: SuiteResult[] = [];
    const nodefs = require('fs') as typeof import('fs');

    // Convert globs to concrete paths by extracting the directory portion up to the first wildcard
    // For standard patterns like '**/target/surefire-reports/TEST-*.xml' we resolve the report dir
    // relative to moduleDir by stripping the leading '**/' and taking the parent of the file pattern.
    const resolvedDirs = new Set<string>();
    for (const glob of reportGlobs) {
        // Strip leading '**/' or '*/' prefix
        const stripped = glob.replace(/^\*+\//, '');
        // Take the directory portion (everything before the last '/')
        const dir = stripped.includes('/') ? stripped.substring(0, stripped.lastIndexOf('/')) : stripped;
        resolvedDirs.add(path.join(moduleDir, dir));
    }

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

        // Extract class or method target from the item ID
        if (parts.length >= 3) {
            const classSegment = parts[2]; // e.g. "CreateChannelsAdTest" or "CreateChannelsAdTest#method"
            entry.classNames.push(classSegment);
        }
        // If only module or package is selected, run the whole module
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
