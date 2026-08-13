import * as vscode from 'vscode';
import {
    CONFIG_SECTION,
    CONFIG_MAVEN_EXECUTABLE,
    CONFIG_DEFAULT_COMMAND,
    CONFIG_DEFAULT_PROFILES,
    CONFIG_ADDITIONAL_ARGS,
    CONFIG_REPORT_GLOBS,
    CONFIG_WATCH_REPORTS,
    CONFIG_CLEAR_REPORTS_BEFORE_RUN,
    CONFIG_TEST_CLASS_COMMAND_TEMPLATE,
    CONFIG_SHOW_OUTPUT_CHANNEL,
    CONFIG_AUTO_REFRESH_ON_SAVE,
    CONFIG_AUTO_REFRESH_DEBOUNCE_MS,
    CONFIG_MAX_HISTORY_ENTRIES,
    CONFIG_RUN_HISTORY_ENABLED,
    CONFIG_TEST_SOURCE_GLOBS,
    CONFIG_PREFER_MAVEN_WRAPPER,
    JAVA_TEST_GLOB,
    SUREFIRE_GLOB,
    FAILSAFE_GLOB,
    DEFAULT_CLASS_TEMPLATE,
} from './constants';

export interface ExtensionSettings {
    readonly mavenExecutable: string;
    readonly defaultCommand: string;
    readonly defaultProfiles: readonly string[];
    readonly additionalArgs: string;
    readonly reportGlobs: readonly string[];
    readonly watchReports: boolean;
    readonly clearReportsBeforeRun: boolean;
    readonly testClassCommandTemplate: string;
    readonly showOutputChannel: boolean;
    readonly autoRefreshOnSave: boolean;
    readonly maxHistoryEntries: number;
    readonly runHistoryEnabled: boolean;
    readonly testSourceGlobs: readonly string[];
    readonly preferMavenWrapper: boolean;
    readonly autoRefreshDebounceMs: number;
}

export function readSettings(): ExtensionSettings {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
        mavenExecutable: cfg.get<string>(CONFIG_MAVEN_EXECUTABLE, 'mvn'),
        defaultCommand: cfg.get<string>(CONFIG_DEFAULT_COMMAND, 'clean test'),
        defaultProfiles: cfg.get<string[]>(CONFIG_DEFAULT_PROFILES, []),
        additionalArgs: cfg.get<string>(CONFIG_ADDITIONAL_ARGS, ''),
        reportGlobs: cfg.get<string[]>(CONFIG_REPORT_GLOBS, [SUREFIRE_GLOB, FAILSAFE_GLOB]),
        watchReports: cfg.get<boolean>(CONFIG_WATCH_REPORTS, true),
        clearReportsBeforeRun: cfg.get<boolean>(CONFIG_CLEAR_REPORTS_BEFORE_RUN, true),
        testClassCommandTemplate: cfg.get<string>(CONFIG_TEST_CLASS_COMMAND_TEMPLATE, DEFAULT_CLASS_TEMPLATE),
        showOutputChannel: cfg.get<boolean>(CONFIG_SHOW_OUTPUT_CHANNEL, true),
        autoRefreshOnSave: cfg.get<boolean>(CONFIG_AUTO_REFRESH_ON_SAVE, true),
        maxHistoryEntries: cfg.get<number>(CONFIG_MAX_HISTORY_ENTRIES, 20),
        runHistoryEnabled: cfg.get<boolean>(CONFIG_RUN_HISTORY_ENABLED, true),
        testSourceGlobs: cfg.get<string[]>(CONFIG_TEST_SOURCE_GLOBS, [JAVA_TEST_GLOB]),
        preferMavenWrapper: cfg.get<boolean>(CONFIG_PREFER_MAVEN_WRAPPER, true),
        autoRefreshDebounceMs: cfg.get<number>(CONFIG_AUTO_REFRESH_DEBOUNCE_MS, 500),
    };
}
